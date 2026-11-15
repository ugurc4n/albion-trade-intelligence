import type { OrderbookLevel } from "@/lib/albion/schemas";
import { parseApiDate } from "./normalize";

/** Price tolerance when walking the book: we accept levels up to 3% worse than the reference price. */
export const DEPTH_TOLERANCE = 0.03;

/**
 * Levels seen this long before the latest price observation are treated as gone. The order book endpoint
 * keeps levels from older client observations: e.g. a cheap sell level seen 8 h ago while the price endpoint
 * saw a much higher minimum 3 minutes ago has almost certainly been bought already.
 */
export const LEVEL_STALENESS_SLACK_MS = 15 * 60_000;

export function isLevelSuperseded(level: OrderbookLevel, latestQuoteAt: number | null): boolean {
  if (latestQuoteAt === null) return false;
  const seen = parseApiDate(level.updated_at);
  return seen === null || seen < latestQuoteAt - LEVEL_STALENESS_SLACK_MS;
}

/**
 * Units available for an instant trade near the reference price.
 * - side "sell": levels of sell orders (we instant-buy) with price ≤ ref × (1 + tolerance)
 * - side "buy":  levels of buy orders (we instant-sell) with price ≥ ref × (1 − tolerance)
 * Levels superseded by a newer price observation (`latestQuoteAt`) are ignored.
 */
export function depthNearPrice(
  levels: OrderbookLevel[],
  refPrice: number,
  side: "sell" | "buy",
  latestQuoteAt: number | null = null,
  tolerance = DEPTH_TOLERANCE,
): number {
  let total = 0;
  for (const level of levels) {
    if (isLevelSuperseded(level, latestQuoteAt)) continue;
    const ok = side === "sell" ? level.price <= refPrice * (1 + tolerance) : level.price >= refPrice * (1 - tolerance);
    if (ok) total += Math.max(0, level.amount);
  }
  return total;
}
