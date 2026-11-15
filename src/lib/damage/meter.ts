import { expandRows, isIdTag, isObjectIdLike } from "./extract";
import { messageSignature, type PhotonMessage } from "./photon";
import type { DamageConfig, PlayerStats, SessionRecord } from "./types";

const MAX_IDENTITIES = 5000;
/** Sanity bound: a single health change beyond this is treated as corrupt data, not damage. */
const MAX_SINGLE_CHANGE = 10_000_000;

export type MeterOptions = {
  /** Start a session on the first player hit and close it after `idleMs` without player activity. */
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
  return { name, damage: 0, heal: 0, taken: 0, hits: 0, firstAt: null, lastAt: null };
}

function autoLabel(at: number): string {
  return `Otomatik · ${new Date(at).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })}`;
}

/**
 * Turns decoded messages into per-player damage/heal totals using a calibrated config.
 * Object ids are re-learned continuously because the game assigns new ids on every zone change.
 * All times are "stream time" (capture timestamps), so the capture PC's clock is the only clock used.
 */
export class DamageMeter {
  private identities = new Map<number, string>();
  private session: SessionRecord | null = null;
  private players = new Map<string, PlayerStats>();
  private lastActivityAt: number | null = null;
  private options: MeterOptions;
  /** Own character: learned from identity rules carried by operation responses (the join reply). */
  private self: string | null = null;

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
    this.lastActivityAt = null;
    this.session = {
      id,
      label,
      startedAt: now,
      endedAt: null,
      players: [],
      unattributedDamage: 0,
      configCalibratedAt: this.config?.calibratedAt ?? null,
      auto,
    };
    return this.snapshot()!;
  }

  stopSession(now: number): SessionRecord | null {
    if (!this.session) return null;
    this.session.endedAt = now;
    const done = this.snapshot();
    this.session = null;
    this.players = new Map();
    this.lastActivityAt = null;
    return done;
  }

  /**
   * Closes an auto session once nobody has hit or healed for `idleMs` (stream time). Returns the session
   * to save, or null — also null when it was too small to keep (it is discarded).
   */
  tick(now: number): { saved: SessionRecord | null; discarded: boolean } {
    const s = this.session;
    if (!s?.auto || this.lastActivityAt === null || now - this.lastActivityAt < this.options.idleMs) {
      return { saved: null, discarded: false };
    }
    const done = this.stopSession(this.lastActivityAt)!;
    const hits = done.players.reduce((sum, p) => sum + p.hits, 0);
    return hits >= this.options.minHits ? { saved: done, discarded: false } : { saved: null, discarded: true };
  }

  snapshot(): SessionRecord | null {
    if (!this.session) return null;
    return {
      ...this.session,
      players: [...this.players.values()].map((p) => ({ ...p })).sort((a, b) => b.damage - a.damage),
    };
  }

  /** Learns object id → name mappings only (no damage counting) — used when replaying old traffic. */
  learnIdentities(msg: PhotonMessage) {
    const config = this.config;
    if (!config) return;
    const sig = messageSignature(msg);
    for (const rule of config.identity) {
      if (rule.signature !== sig) continue;
      const name = msg.params.get(rule.nameKey);
      const id = msg.params.get(rule.idKey);
      if (typeof name === "string" && name.length > 0 && isObjectIdLike(id) && isIdTag(msg.types.get(rule.idKey))) {
        this.learn(id, name);
        if (msg.kind === "response") this.self = name;
      }
    }
  }

  handle(msg: PhotonMessage) {
    const config = this.config;
    if (!config) return;
    this.learnIdentities(msg);
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
        if (targetName && !self) this.stats(targetName).taken += -change;
        if (self || targetName) continue; // player-on-player or self damage is not counted as dealt damage
        if (!causerName) {
          session.unattributedDamage += -change;
          continue;
        }
        const p = this.stats(causerName);
        p.damage += -change;
        p.hits++;
        p.firstAt ??= msg.at;
        p.lastAt = msg.at;
      } else if (causerName && !self) {
        const p = this.stats(causerName);
        p.heal += change;
        p.firstAt ??= msg.at;
        p.lastAt = msg.at;
      }
      if (playerHit || playerHeal) this.lastActivityAt = Math.max(this.lastActivityAt ?? 0, msg.at);
    }
  }

  private learn(id: number, name: string) {
    if (this.identities.get(id) === name) return;
    this.identities.delete(id);
    this.identities.set(id, name);
    if (this.identities.size > MAX_IDENTITIES) this.identities.delete(this.identities.keys().next().value!);
  }

  private stats(name: string): PlayerStats {
    let p = this.players.get(name);
    if (!p) {
      p = emptyStats(name);
      this.players.set(name, p);
    }
    return p;
  }
}
