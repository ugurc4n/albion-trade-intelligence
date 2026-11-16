import { expandRows, isFloatTag, isIdTag, isObjectIdLike } from "./extract";
import { EQUIPMENT_CHANGED_EVENT, mainHandFromIndex, readEquipmentItem, readJoinEquipment, readMainHand } from "./equipment";
import { DEFAULT_HEALTH_RULE, readJoin, readNewCharacter } from "./identity";
import { readFameReward } from "./fame";
import { messageSignature, type PhotonMessage } from "./photon";
import type { PhotonValue } from "./protocol18";
import { readSilverShare } from "./silver";
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
  return { name, mainHand: null, damage: 0, heal: 0, taken: 0, hits: 0, kills: 0, firstAt: null, lastAt: null };
}

function newRun(zone: string | null, at: number): RunRecord {
  return { zone, startedAt: at, endedAt: null, fame: 0, silver: 0, damage: 0, kills: 0 };
}

/**
 * HealthUpdates, the batched form of the calibrated hit event, comes right after it in the game's event list
 * (HealthUpdate 6, HealthUpdates 7 in the live capture): same keys, one array entry per hit.
 */
function isBatchedHealth(msg: PhotonMessage, healthSignature: string): boolean {
  return msg.kind === "event" && healthSignature === `event:${msg.code - 1}`;
}

/**
 * In batched events a list of small ids arrives as a byte array (live capture: causers [227, 227] tagged "x"),
 * so it is read as a list like any other array.
 */
function withByteListsAsArrays(params: ReadonlyMap<number, PhotonValue>, keys: readonly number[]): Map<number, PhotonValue> {
  const out = new Map(params);
  for (const k of keys) {
    const v = params.get(k);
    if (v instanceof Uint8Array) out.set(k, Array.from(v));
  }
  return out;
}

/**
 * The hit event's other float is the target's remaining health. The game leaves it out when it is 0, so a
 * hit without it is the killing blow (live capture: 27 of 28 mobs; the 28th died in a batch with health 0).
 * Returns null when the message has no such key (the remaining health is then 0).
 */
function remainingHealthKey(msg: PhotonMessage, changeKey: number): number | null {
  for (const [key, tag] of msg.types) if (key !== changeKey && key < 252 && isFloatTag(tag)) return key;
  return null;
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
  /** Silver shares already counted: calibration replays the same message objects, which must not count twice. */
  private silverCounted = new WeakSet<PhotonMessage>();
  /** Silver received per player name in this session, and per run (yours is read by name at snapshot time). */
  private silverByName = new Map<string, { net: number; shares: number; lastAt: number }>();
  private runSilver = new WeakMap<RunRecord, Map<string, number>>();
  /** Mobs whose killing blow was counted: a mob dies once, however often the hit is replayed or repeated. */
  private killed = new Set<number>();
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
    this.silverByName = new Map();
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
    this.silverByName = new Map();
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
    // Your silver is looked up by name, so shares received before the join reply named you still count.
    const mine = this.self ? this.silverByName.get(this.self) : undefined;
    return {
      ...this.session,
      fame: this.session.fame ? { ...this.session.fame } : null,
      silver: mine && this.self ? { name: this.self, net: mine.net, pickups: mine.shares, lastAt: mine.lastAt } : null,
      runs: this.session.runs?.map((r) => ({ ...r, silver: (this.self && this.runSilver.get(r)?.get(this.self)) || 0 })),
      balance: this.session.balance ? { ...this.session.balance } : null,
      players: [...this.players.values()].map((p) => ({
        ...p,
        mainHand: p.mainHand ? { ...p.mainHand, item: p.mainHand.item ? { ...p.mainHand.item } : null } : null,
      })).sort((a, b) => b.damage - a.damage),
    };
  }

  /** Learns player identities and equipment without counting damage — also used for traffic replay. */
  learnIdentities(msg: PhotonMessage) {
    // Names come only from the join reply (you) and NewCharacter (everyone else); see identity.ts.
    const self = readJoin(msg);
    if (self) {
      this.setSelf(self.id, self.name);
      this.selfEquipment = readJoinEquipment(msg);
      this.resolveSelfMainHand(msg.at);
    }
    const other = readNewCharacter(msg);
    if (other && other.id !== this.selfId) {
      this.learn(other.id, other.name);
      this.learnEquipment(other.id, readMainHand(msg, 40), msg.at);
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
  }

  handle(msg: PhotonMessage) {
    this.learnIdentities(msg);
    this.handleZone(msg);
    this.handleFame(msg);
    this.handleSilver(msg);
    const sig = messageSignature(msg);

    // A saved calibration only exists when a patch moved the hit event; otherwise the verified layout is used.
    const h = this.config?.health ?? DEFAULT_HEALTH_RULE;
    if (h.signature !== sig && !isBatchedHealth(msg, h.signature)) return;
    const healthKey = remainingHealthKey(msg, h.changeKey);
    const keys = [h.causerKey, h.changeKey, ...(h.targetKey === null ? [] : [h.targetKey]), ...(healthKey === null ? [] : [healthKey])];
    const params = withByteListsAsArrays(msg.params, keys);
    if (Array.isArray(params.get(h.changeKey)) !== Array.isArray(params.get(h.causerKey))) return;
    for (const row of expandRows(params, keys)) {
      const causer = row.get(h.causerKey);
      const change = row.get(h.changeKey);
      const target = h.targetKey === null ? null : row.get(h.targetKey);
      const remaining = healthKey === null ? 0 : row.get(healthKey);
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
        const run = this.currentRun()!;
        run.damage += -change;
        if (remaining === 0 && isObjectIdLike(target) && !this.killed.has(target)) {
          this.killed.add(target);
          if (this.killed.size > MAX_ITEM_OBJECTS) this.killed.delete(this.killed.keys().next().value!);
          p.kills = (p.kills ?? 0) + 1;
          run.kills = (run.kills ?? 0) + 1;
        }
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
    // started mid-zone (no join reply yet). The real name replaces the placeholder at the next join; a name
    // learned for that id from other messages is not trusted for you.
    if (this.selfId === null) this.setSelf(reward.objectId, SELF_PLACEHOLDER);
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

  /** Every player's silver share (solo: all your pickups; party: each member's cut of every pickup). */
  private handleSilver(msg: PhotonMessage) {
    const share = readSilverShare(msg);
    if (!share || this.silverCounted.has(msg)) return;
    this.silverCounted.add(msg);
    if (!this.session && this.options.autoSession) {
      this.startSession(this.options.newId(msg.at), autoLabel(msg.at), msg.at, true);
    }
    const session = this.session;
    if (!session || msg.at < session.startedAt) return;
    const total = this.silverByName.get(share.name) ?? { net: 0, shares: 0, lastAt: msg.at };
    total.net += share.amount;
    total.shares++;
    total.lastAt = Math.max(total.lastAt, msg.at);
    this.silverByName.set(share.name, total);
    const p = this.row(share.name);
    p.silver = (p.silver ?? 0) + share.amount;
    const run = this.currentRun()!;
    const byName = this.runSilver.get(run) ?? new Map<string, number>();
    byName.set(share.name, (byName.get(share.name) ?? 0) + share.amount);
    this.runSilver.set(run, byName);
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
        existing.kills = (existing.kills ?? 0) + (old.kills ?? 0);
        existing.silver = (existing.silver ?? 0) + (old.silver ?? 0);
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

  /** A player's row without touching equipment (for data that carries a name but no object id). */
  private row(name: string): PlayerStats {
    let p = this.players.get(name);
    if (!p) {
      p = emptyStats(name);
      this.players.set(name, p);
    }
    return p;
  }

  private stats(name: string, objectId: number, at: number): PlayerStats {
    const p = this.row(name);
    const equipment = this.equipment.get(objectId);
    this.applyEquipment(p, equipment?.mainHand ?? null, equipment?.at ?? at);
    return p;
  }
}
