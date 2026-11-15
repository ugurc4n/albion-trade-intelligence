import type { HistoryPoint } from "@/lib/albion/schemas";
import { parseApiDate } from "./normalize";
import type { VolumeStats } from "./types";

const DAY_MS = 86_400_000;

/**
 * Derives liquidity and volatility from daily history points (time-scale=24).
 * item_count only reflects sales observed by data-client users, so it is a lower bound of real volume.
 */
export function computeVolumeStats(points: HistoryPoint[], now: number, windowDays = 7): VolumeStats {
  const cutoff = now - windowDays * DAY_MS;
  const inWindow = points
    .map((p) => ({ ...p, at: parseApiDate(p.timestamp) }))
    .filter((p): p is HistoryPoint & { at: number } => p.at !== null && p.at >= cutoff && p.at <= now + DAY_MS);

  if (inWindow.length === 0) {
    return { avgDailyVolume: null, avgPrice: null, volatility: null, daysWithData: 0, windowDays, lastTimestamp: null };
  }

  let totalCount = 0;
  let weighted = 0;
  for (const p of inWindow) {
    totalCount += Math.max(0, p.item_count);
    weighted += Math.max(0, p.item_count) * p.avg_price;
  }

  const prices = inWindow.map((p) => p.avg_price).filter((p) => p > 0);
  let volatility: number | null = null;
  if (prices.length >= 3) {
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((a, b) => a + (b - mean) ** 2, 0) / prices.length;
    volatility = mean > 0 ? Math.sqrt(variance) / mean : null;
  }

  const days = new Set(inWindow.map((p) => Math.floor(p.at / DAY_MS)));

  return {
    avgDailyVolume: totalCount / windowDays,
    avgPrice: totalCount > 0 ? weighted / totalCount : null,
    volatility,
    daysWithData: days.size,
    windowDays,
    lastTimestamp: Math.max(...inWindow.map((p) => p.at)),
  };
}
