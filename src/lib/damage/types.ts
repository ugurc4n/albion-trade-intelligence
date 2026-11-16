import { z } from "zod";

/**
 * Which message carries "this object id belongs to this player name".
 * signature = "event:29" / "response:2" (see messageSignature).
 */
export const identityRuleSchema = z.object({
  signature: z.string().regex(/^(event|request|response):\d+$/),
  nameKey: z.number().int().min(0).max(255),
  idKey: z.number().int().min(0).max(255),
});

/** Which event carries "causer changed target's health by N" (negative = damage, positive = healing). */
export const healthRuleSchema = z.object({
  signature: z.string().regex(/^event:\d+$/),
  causerKey: z.number().int().min(0).max(255),
  changeKey: z.number().int().min(0).max(255),
  targetKey: z.number().int().min(0).max(255).nullable(),
});

export const damageConfigSchema = z.object({
  version: z.literal(1),
  identity: z.array(identityRuleSchema).min(1).max(10),
  health: healthRuleSchema,
  calibratedAt: z.string(),
  /** "auto" = applied by the background calibrator, "manual" = confirmed by the user. */
  source: z.enum(["auto", "manual"]).default("manual"),
});

export const damageSettingsSchema = z.object({
  /** Learn/refresh the calibration from live traffic without asking. */
  autoCalibrate: z.boolean().default(true),
  /** Start a session on the first hit and save it after a quiet period. */
  autoSession: z.boolean().default(true),
  idleMinutes: z.number().int().min(1).max(30).default(5),
});

export type DamageSettings = z.infer<typeof damageSettingsSchema>;
export const DEFAULT_DAMAGE_SETTINGS: DamageSettings = { autoCalibrate: true, autoSession: true, idleMinutes: 5 };

export type IdentityRule = z.infer<typeof identityRuleSchema>;
export type HealthRule = z.infer<typeof healthRuleSchema>;
export type DamageConfig = z.output<typeof damageConfigSchema>;

/** Last observed Main Hand. A null item means an explicitly empty slot (Unarmed). */
export type MainHandObservation = {
  item: { id: string; nameEn: string; tier: number; enchant: number } | null;
  observedAt: number;
};

export type PlayerStats = {
  name: string;
  /** Missing/null means unknown; optional so saved sessions from older versions still load. */
  mainHand?: MainHandObservation | null;
  /** Damage dealt by this player (sum of negative health changes they caused on others). */
  damage: number;
  /** Healing done (positive health changes caused on others; may include overheal). */
  heal: number;
  /** Damage taken (needs a target key in the config). */
  taken: number;
  hits: number;
  firstAt: number | null;
  lastAt: number | null;
};

/** Own character only: captured UpdateFame rewards, not a party-wide estimate. */
export type FameStats = {
  name: string;
  total: number;
  /** Reward with its zone multiplier, before Premium and Satchel. */
  zoneIncluded: number;
  premium: number;
  satchel: number;
  events: number;
  lastAt: number;
  /** Latest reported modifier; already included in the reward, never multiplied again. */
  lastBonusPercent: number | null;
};

/** Own character only: silver picked up (TakeSilver), after cluster/guild tax. Not trades, repairs or sales. */
export type SilverStats = {
  name: string;
  /** Received after taxes. */
  net: number;
  preTax: number;
  tax: number;
  pickups: number;
  lastAt: number;
};

export type SessionRecord = {
  id: string;
  label: string;
  startedAt: number;
  /** null while the session is running. */
  endedAt: number | null;
  players: PlayerStats[];
  /** Optional for older saved sessions. Null means no own-character Fame reward was captured. */
  fame?: FameStats | null;
  /** Optional for older saved sessions. Null means no own silver pickup was captured. */
  silver?: SilverStats | null;
  /** Damage on non-players whose causer could not be matched to a player name (pets, unseen players). */
  unattributedDamage: number;
  configCalibratedAt: string | null;
  /** Started on the first hit and closed after a quiet period (vs. started/stopped by hand). */
  auto?: boolean;
};

export type SessionSummary = Pick<SessionRecord, "id" | "label" | "startedAt" | "endedAt" | "unattributedDamage"> & {
  totalDamage: number;
  playerCount: number;
  topPlayer: string | null;
  fame?: Pick<FameStats, "name" | "total"> | null;
  silver?: Pick<SilverStats, "name" | "net"> | null;
};

export function summarizeSession(s: SessionRecord): SessionSummary {
  const sorted = [...s.players].sort((a, b) => b.damage - a.damage);
  return {
    id: s.id,
    label: s.label,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    unattributedDamage: s.unattributedDamage,
    totalDamage: s.players.reduce((sum, p) => sum + p.damage, 0),
    playerCount: new Set([...s.players.map((p) => p.name), ...(s.fame ? [s.fame.name] : []), ...(s.silver ? [s.silver.name] : [])]).size,
    topPlayer: sorted[0]?.damage ? sorted[0].name : null,
    fame: s.fame ? { name: s.fame.name, total: s.fame.total } : null,
    silver: s.silver ? { name: s.silver.name, net: s.silver.net } : null,
  };
}
