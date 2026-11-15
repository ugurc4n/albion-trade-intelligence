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

export type PlayerStats = {
  name: string;
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

export type SessionRecord = {
  id: string;
  label: string;
  startedAt: number;
  /** null while the session is running. */
  endedAt: number | null;
  players: PlayerStats[];
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
    playerCount: s.players.length,
    topPlayer: sorted[0]?.damage ? sorted[0].name : null,
  };
}
