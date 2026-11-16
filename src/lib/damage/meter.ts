import { looksLikeCharacterName } from "./calibrate";
import { expandRows, isIdTag, isObjectIdLike } from "./extract";
import { EQUIPMENT_CHANGED_EVENT, NEW_CHARACTER_EVENT, mainHandFromIndex, readEquipmentItem, readJoinEquipment, readMainHand } from "./equipment";
import { readFameReward } from "./fame";
import { messageSignature, type PhotonMessage } from "./photon";
import { readSilverPickup } from "./silver";
import type { DamageConfig, MainHandObservation, PlayerStats, RunRecord, SessionRecord } from "./types";
import { readBalanceUpdate, readJoinZone } from "./zone";

const MAX_IDENTITIES = 5000;
const MAX_ITEM_OBJECTS = 20_000;
/** Shown for your own character until the join reply (next zone change) gives the real name. */
export const SELF_PLACEHOLDER = "Sen";
/** Sanity bound: a single health change beyond this is treated as corrupt data, not damage. */
const MAX_SINGLE_CHANGE = 10_000_000;

export type MeterOptions = {
  /** Start on a player hit or own Fame reward; close after `idleMs` without player activity. */
  autoSession: boolean;
  idleMs: number;
  /** Auto sessions with fewer player hits than this are discarded instead of saved (stray open-world hits). */
  minHits: number;
  newId: (at: number) => string;
};

const DEFAULT_OPTIONS: MeterOptions = {
  autoSession: false,
  idleMs: 5 * 60_000,
  minHits: 10,
  newId: (at) => `s-${at}`,
};

function emptyStats(name: string): PlayerStats {
  return { name, mainHand: null, damage: 0, heal: 0, taken: 0, hits: 0, firstAt: null, lastAt: null };
}

function newRun(zone: string | null, at: number): RunRecord {
  return { zone, startedAt: at, endedAt: null, fame: 0, silver: 0, damage: 0 };
}

function autoLabel(at: number): string {
  return `Auto · ${new Date(at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}`;
}

/**
 * Turns decoded messages into per-player damage/heal totals using a calibrated config.
 * Object ids are re-learned continuously because the game assigns new ids on every zone change.
 * All times are "stream time" (capture timestamps), so the capture PC's clock is the only clock used.
 */
export class DamageMeter {
  private identities = new Map<number, string>();
  /** Ids named since the last join reply (zone change): within a zone an object id keeps its first name. */
  private zoneIds = new Set<number>();
  private equipment = new Map<number, { mainHand: MainHandObservation | null; at: number }>();
  private session: SessionRecord | null = null;
  private players = new Map<string, PlayerStats>();
  private playerEquipmentAt = new Map<string, number>();
  private lastActivityAt: number | null = null;
  private options: MeterOptions;
  /** Own character: learned from identity rules carried by operation responses (the join reply). */
  private self: string | null = null;
  private selfId: number | null = null;
  /** Lifetime counters prevent UDP duplicates and calibration replay from counting rewards twice. */
  private fameCounters = new Map<string, number>();
  /** Silver pickups already counted (tick:silver object), for the same duplicate/replay protection. */
  private silverSeen = new Set<string>();
  /** Item object id → item index (NewEquipmentItem); used to resolve your own Main Hand. */
  private itemObjects = new Map<number, number>();
  /** Object ids of your equipped items from the last join reply (slot 0 = Main Hand). */
  private selfEquipment: number[] | null = null;
  /** Current zone and own silver balance, with the stream time they were seen (replay never moves them back). */
  private zone: { id: string; at: number } | null = null;
  private balance: { value: number; at: number } | null = null;

  constructor(
    private config: DamageConfig | null = null,
    options: Partial<MeterOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  setConfig(config: DamageConfig | null) {
    this.config = config;
  }

  getConfig(): DamageConfig | null {
    return this.config;
  }

  setOptions(options: Partial<MeterOptions>) {
    this.options = { ...this.options, ...options };
  }

  get identityCount(): number {
    return this.identities.size;
  }

  get selfName(): string | null {
    return this.self;
  }

  /** Current object id → name map (read-only view). */
  knownIdentities(): ReadonlyMap<number, string> {
    return this.identities;
  }

  nameOf(objectId: number): string | undefined {
    return this.identities.get(objectId);
  }

  startSession(id: string, label: string, now: number, auto = false): SessionRecord {
    this.players = new Map();
    this.playerEquipmentAt = new Map();
    this.lastActivityAt = null;
    this.session = {
      id,
      label,
      startedAt: now,
      endedAt: null,
      players: [],
      fame: null,
      silver: null,
      runs: [newRun(this.zone?.id ?? null, now)],
      balance: this.balance ? { start: this.balance.value, end: this.balance.value } : null,
      unattributedDamage: 0,
      configCalibratedAt: this.config?.calibratedAt ?? null,
      auto,
    };
    return this.snapshot()!;
  }

  stopSession(now: number): SessionRecord | null {
    if (!this.session) return null;
    this.session.endedAt = now;
    // An auto session ends at its last activity: zones entered after that are not part of it.
    const runs = this.session.runs!.filter((r, i) => i === 0 || r.startedAt <= now);
    runs[runs.length - 1].endedAt = Math.max(now, runs[runs.length - 1].startedAt);
    this.session.runs = runs;
    const done = this.snapshot();
    this.session = null;
    this.players = new Map();
    this.playerEquipmentAt = new Map();
    this.lastActivityAt = null;
    return done;
  }

  /**
   * Closes an auto session without hits, healing or own Fame for `idleMs` (stream time). Returns the session
   * to save, or null — also null when it was too small to keep (it is discarded).
   */
  tick(now: number): { saved: SessionRecord | null; discarded: boolean } {
    const s = this.session;
    if (!s?.auto || this.lastActivityAt === null || now - this.lastActivityAt < this.options.idleMs) {
      return { saved: null, discarded: false };
    }
    const done = this.stopSession(this.lastActivityAt)!;
    const hits = done.players.reduce((sum, p) => sum + p.hits, 0);
    return hits >= this.options.minHits || (done.fame?.events ?? 0) > 0 || (done.silver?.pickups ?? 0) > 0
      ? { saved: done, discarded: false } : { saved: null, discarded: true };
  }

  snapshot(): SessionRecord | null {
    if (!this.session) return null;
    return {
      ...this.session,
      fame: this.session.fame ? { ...this.session.fame } : null,
      silver: this.session.silver ? { ...this.session.silver } : null,
      runs: this.session.runs?.map((r) => ({ ...r })),
      balance: this.session.balance ? { ...this.session.balance } : null,
      players: [...this.players.values()].map((p) => ({
        ...p,
        mainHand: p.mainHand ? { ...p.mainHand, item: p.mainHand.item ? { ...p.mainHand.item } : null } : null,
      })).sort((a, b) => b.damage - a.damage),
    };
  }

  /** Learns player identities and equipment without counting damage — also used for traffic replay. */
  learnIdentities(msg: PhotonMessage) {
    // The local join reply is also needed for Fame before damage calibration is available.
    if (msg.kind === "response" && msg.code === 2) {
      const id = msg.params.get(0);
      const name = msg.params.get(2);
      if (isObjectIdLike(id) && isIdTag(msg.types.get(0)) && typeof name === "string" && name.length > 0) {
        this.zoneIds.clear();
        this.setSelf(id, name);
        this.selfEquipment = readJoinEquipment(msg);
        this.resolveSelfMainHand(msg.at);
      }
    }
    const equipmentItem = readEquipmentItem(msg);
    if (equipmentItem) {
      this.itemObjects.delete(equipmentItem.objectId);
      this.itemObjects.set(equipmentItem.objectId, equipmentItem.index);
      if (this.itemObjects.size > MAX_ITEM_OBJECTS) this.itemObjects.delete(this.itemObjects.keys().next().value!);
      if (this.selfEquipment?.[0] === equipmentItem.objectId) this.resolveSelfMainHand(msg.at);
    }
    if (msg.kind === "event" && msg.code === EQUIPMENT_CHANGED_EVENT) {
      const id = msg.params.get(0);
      if (isObjectIdLike(id) && isIdTag(msg.types.get(0))) this.learnEquipment(id, readMainHand(msg, 2), msg.at);
    }
    const config = this.config;
    if (!config) return;
    const sig = messageSignature(msg);
    for (const rule of config.identity) {
      if (rule.signature !== sig) continue;
      const name = msg.params.get(rule.nameKey);
      const id = msg.params.get(rule.idKey);
      // Guild/alliance tags and mob names are not character names (a two-letter tag once took a party's hits).
      if (typeof name !== "string" || !looksLikeCharacterName(name) || !isObjectIdLike(id) || !isIdTag(msg.types.get(rule.idKey))) {
        continue;
      }
      // Your real name may arrive from another identity message before the next join reply.
      if (msg.kind === "response" || (id === this.selfId && this.self === SELF_PLACEHOLDER)) {
        this.setSelf(id, name);
      } else {
        // An id already named in this zone (or you) keeps that name unless the character spawns again: other
        // messages pairing it with another name are look-alikes, e.g. KnockedDown carries the victim's id
        // next to the attacker's name.
        const known = this.identities.get(id);
        const spawn = msg.kind === "event" && msg.code === NEW_CHARACTER_EVENT && id !== this.selfId;
        if (!spawn && known !== undefined && known !== name && (this.zoneIds.has(id) || id === this.selfId)) continue;
        this.learn(id, name);
      }
      if (msg.kind === "event" && rule.nameKey === 1) this.learnEquipment(id, readMainHand(msg, 40), msg.at);
    }
  }

  handle(msg: PhotonMessage) {
    this.learnIdentities(msg);
    this.handleZone(msg);
    this.handleFame(msg);
    this.handleSilver(msg);
    const config = this.config;
    if (!config) return;
    const sig = messageSignature(msg);

    const h = config.health;
    if (h.signature !== sig) return;
    if (Array.isArray(msg.params.get(h.changeKey)) !== Array.isArray(msg.params.get(h.causerKey))) return;
    const keys = h.targetKey === null ? [h.causerKey, h.changeKey] : [h.causerKey, h.changeKey, h.targetKey];
    for (const row of expandRows(msg.params, keys)) {
      const causer = row.get(h.causerKey);
      const change = row.get(h.changeKey);
      const target = h.targetKey === null ? null : row.get(h.targetKey);
      if (typeof change !== "number" || !Number.isFinite(change) || change === 0 || Math.abs(change) > MAX_SINGLE_CHANGE) continue;

      const causerName = isObjectIdLike(causer) ? this.identities.get(causer) : undefined;
      const targetName = isObjectIdLike(target) ? this.identities.get(target) : undefined;
      const self = target !== null && target === causer;
      const playerHit = change < 0 && !!causerName && !self && !targetName;
      const playerHeal = change > 0 && !!causerName && !self;

      if (!this.session && this.options.autoSession && playerHit) {
        this.startSession(this.options.newId(msg.at), autoLabel(msg.at), msg.at, true);
      }
      const session = this.session;
      if (!session) continue;

      if (change < 0) {
        if (targetName && !self) this.stats(targetName, Number(target), msg.at).taken += -change;
        if (self || targetName) continue; // player-on-player or self damage is not counted as dealt damage
        if (!causerName) {
          session.unattributedDamage += -change;
          continue;
        }
        const p = this.stats(causerName, Number(causer), msg.at);
        p.damage += -change;
        p.hits++;
        this.currentRun()!.damage += -change;
        p.firstAt ??= msg.at;
        p.lastAt = msg.at;
      } else if (causerName && !self) {
        const p = this.stats(causerName, Number(causer), msg.at);
        p.heal += change;
        p.firstAt ??= msg.at;
        p.lastAt = msg.at;
      }
      if (playerHit || playerHeal) this.lastActivityAt = Math.max(this.lastActivityAt ?? 0, msg.at);
    }
  }

  private handleFame(msg: PhotonMessage) {
    const reward = readFameReward(msg);
    if (!reward) return;
    // The game sends UpdateFame only for the local player, so it identifies you even when the capture
    // started mid-zone (no join reply yet). The real name replaces the placeholder at the next join.
    if (this.selfId === null) this.setSelf(reward.objectId, this.identities.get(reward.objectId) ?? SELF_PLACEHOLDER);
    if (!this.self || reward.objectId !== this.selfId) return;
    const previous = this.fameCounters.get(this.self);
    if (previous !== undefined && reward.cumulative <= previous) return;
    this.fameCounters.delete(this.self);
    this.fameCounters.set(this.self, reward.cumulative);
    if (this.fameCounters.size > MAX_IDENTITIES) this.fameCounters.delete(this.fameCounters.keys().next().value!);
    if (!this.session && this.options.autoSession) {
      this.startSession(this.options.newId(msg.at), autoLabel(msg.at), msg.at, true);
    }
    const session = this.session;
    if (!session || msg.at < session.startedAt || (session.fame && session.fame.name !== this.self)) return;
    const fame = session.fame ??= {
      name: this.self, total: 0, zoneIncluded: 0, premium: 0, satchel: 0, events: 0,
      lastAt: msg.at, lastBonusPercent: null,
    };
    fame.total += reward.total;
    fame.zoneIncluded += reward.zoneIncluded;
    fame.premium += reward.premium;
    fame.satchel += reward.satchel;
    fame.events++;
    this.currentRun()!.fame += reward.total;
    if (msg.at >= fame.lastAt) {
      fame.lastAt = msg.at;
      fame.lastBonusPercent = reward.lastBonusPercent;
    }
    this.lastActivityAt = Math.max(this.lastActivityAt ?? 0, msg.at);
  }

  /** A join reply is a zone change: it closes the current run and opens the next one. */
  private handleZone(msg: PhotonMessage) {
    const joined = readJoinZone(msg);
    if (joined) {
      if (joined.balance !== null) this.updateBalance(joined.balance, msg.at);
      if (msg.at < (this.zone?.at ?? -Infinity)) return; // replayed older traffic
      this.zone = { id: joined.zone, at: msg.at };
      const run = this.currentRun();
      if (run && msg.at > run.startedAt) {
        run.endedAt = msg.at;
        this.session!.runs!.push(newRun(joined.zone, msg.at));
      }
      return;
    }
    const update = readBalanceUpdate(msg);
    if (update && update.objectId === this.selfId) this.updateBalance(update.balance, msg.at);
  }

  private updateBalance(value: number, at: number) {
    if (at < (this.balance?.at ?? -Infinity)) return;
    this.balance = { value, at };
    const session = this.session;
    if (!session || at < session.startedAt) return;
    session.balance ??= { start: value, end: value };
    session.balance.end = value;
  }

  private currentRun(): RunRecord | undefined {
    return this.session?.runs?.at(-1);
  }

  private handleSilver(msg: PhotonMessage) {
    const pickup = readSilverPickup(msg);
    // Only your own pickups: unlike UpdateFame, nothing guarantees TakeSilver is local-player only.
    if (!pickup || !this.self || pickup.objectId !== this.selfId) return;
    if (pickup.key !== null) {
      if (this.silverSeen.has(pickup.key)) return;
      this.silverSeen.add(pickup.key);
      if (this.silverSeen.size > MAX_ITEM_OBJECTS) this.silverSeen.delete(this.silverSeen.keys().next().value!);
    }
    if (!this.session && this.options.autoSession) {
      this.startSession(this.options.newId(msg.at), autoLabel(msg.at), msg.at, true);
    }
    const session = this.session;
    if (!session || msg.at < session.startedAt || (session.silver && session.silver.name !== this.self)) return;
    const silver = session.silver ??= { name: this.self, net: 0, preTax: 0, tax: 0, pickups: 0, lastAt: msg.at };
    silver.net += pickup.net;
    silver.preTax += pickup.preTax;
    silver.tax += pickup.tax;
    silver.pickups++;
    silver.lastAt = Math.max(silver.lastAt, msg.at);
    this.currentRun()!.silver += pickup.net;
    this.lastActivityAt = Math.max(this.lastActivityAt ?? 0, msg.at);
  }

  /** Records your own character; a placeholder name (from Fame) is renamed in place once the join reply arrives. */
  private setSelf(id: number, name: string) {
    const previous = this.self;
    const previousId = this.selfId;
    this.self = name;
    this.selfId = id;
    if (previous === SELF_PLACEHOLDER && name !== SELF_PLACEHOLDER) this.renamePlayer(SELF_PLACEHOLDER, name);
    if (previousId === id && this.identities.get(id) === SELF_PLACEHOLDER) {
      this.identities.set(id, name); // same object: keep its equipment
    } else {
      this.learn(id, name);
    }
  }

  private renamePlayer(from: string, to: string) {
    const old = this.players.get(from);
    if (old) {
      this.players.delete(from);
      const existing = this.players.get(to);
      if (existing) {
        existing.damage += old.damage;
        existing.heal += old.heal;
        existing.taken += old.taken;
        existing.hits += old.hits;
        existing.firstAt = Math.min(existing.firstAt ?? Infinity, old.firstAt ?? Infinity);
        if (!Number.isFinite(existing.firstAt)) existing.firstAt = null;
        existing.lastAt = Math.max(existing.lastAt ?? -Infinity, old.lastAt ?? -Infinity);
        if (!Number.isFinite(existing.lastAt)) existing.lastAt = null;
        existing.mainHand ??= old.mainHand;
      } else {
        this.players.set(to, { ...old, name: to });
      }
    }
    const at = this.playerEquipmentAt.get(from);
    if (at !== undefined) {
      this.playerEquipmentAt.delete(from);
      this.playerEquipmentAt.set(to, at);
    }
    const counter = this.fameCounters.get(from);
    if (counter !== undefined) {
      this.fameCounters.delete(from);
      this.fameCounters.set(to, counter);
    }
    if (this.session?.fame?.name === from) this.session.fame.name = to;
    if (this.session?.silver?.name === from) this.session.silver.name = to;
    for (const [id, n] of this.identities) if (n === from) this.identities.set(id, to);
  }

  /** Your Main Hand = the item object in slot 0 of the join reply, once NewEquipmentItem has named it. */
  private resolveSelfMainHand(at: number) {
    if (this.selfId === null || !this.selfEquipment) return;
    const objectId = this.selfEquipment[0];
    if (objectId === 0) return this.learnEquipment(this.selfId, mainHandFromIndex(0, at), at);
    const index = this.itemObjects.get(objectId);
    if (index !== undefined) this.learnEquipment(this.selfId, mainHandFromIndex(index, at), at);
  }

  private learn(id: number, name: string) {
    this.zoneIds.add(id);
    if (this.zoneIds.size > MAX_IDENTITIES) this.zoneIds.delete(this.zoneIds.keys().next().value!);
    if (this.identities.get(id) === name) return;
    // A reused object id must not lend the previous player's weapon to the new player.
    if (this.identities.has(id)) this.equipment.delete(id);
    this.identities.delete(id);
    this.identities.set(id, name);
    if (this.identities.size > MAX_IDENTITIES) {
      const oldest = this.identities.keys().next().value!;
      this.identities.delete(oldest);
      this.equipment.delete(oldest);
    }
  }

  private learnEquipment(id: number, mainHand: MainHandObservation | null | undefined, at: number) {
    if (mainHand === undefined || at < (this.equipment.get(id)?.at ?? -Infinity)) return;
    this.equipment.delete(id);
    this.equipment.set(id, { mainHand, at });
    if (this.equipment.size > MAX_IDENTITIES) this.equipment.delete(this.equipment.keys().next().value!);
    const name = this.identities.get(id);
    const player = name ? this.players.get(name) : undefined;
    if (player) this.applyEquipment(player, mainHand, at);
  }

  private applyEquipment(player: PlayerStats, mainHand: MainHandObservation | null, at: number) {
    if (at < (this.playerEquipmentAt.get(player.name) ?? -Infinity)) return;
    player.mainHand = mainHand;
    this.playerEquipmentAt.set(player.name, at);
  }

  private stats(name: string, objectId: number, at: number): PlayerStats {
    let p = this.players.get(name);
    if (!p) {
      p = emptyStats(name);
      this.players.set(name, p);
    }
    const equipment = this.equipment.get(objectId);
    this.applyEquipment(p, equipment?.mainHand ?? null, equipment?.at ?? at);
    return p;
  }
}
