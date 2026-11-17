import type { PlayerStats, SessionRecord } from "./types";

export const DAMAGE_METRICS = {
  damage: "Damage",
  heal: "Healing",
  taken: "Damage Taken",
} as const;

export type DamageMetric = keyof typeof DAMAGE_METRICS;

/** A view projection only: filtering never changes the recorded session. */
export function playerRanking(session: SessionRecord, metric: DamageMetric, names: string[] | null) {
  const allowed = names ? new Set(names.map((name) => name.toLowerCase())) : null;
  const players = session.players
    .filter((player) => !allowed || allowed.has(player.name.toLowerCase()))
    .slice()
    .sort((a, b) => b[metric] - a[metric] || a.name.localeCompare(b.name));
  const total = players.reduce((sum, player) => sum + player[metric], 0);
  return {
    players,
    total,
    share: (player: PlayerStats) => total > 0 ? player[metric] / total : 0,
  };
}

export function sessionSeconds(session: SessionRecord, now: number) {
  return Math.max(1, ((session.endedAt ?? now) - session.startedAt) / 1000);
}
