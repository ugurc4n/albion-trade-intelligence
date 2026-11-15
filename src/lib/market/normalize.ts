import { toRoyalCity } from "@/lib/albion/constants";
import type { PriceRow } from "@/lib/albion/schemas";
import type { Quote } from "./types";

/**
 * The API returns UTC timestamps without a timezone suffix (e.g. "2026-11-14T18:15:00"),
 * and "0001-01-01T00:00:00" when no order was ever seen.
 */
export function parseApiDate(value: string): number | null {
  if (!value || value.startsWith("0001-01-01")) return null;
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value);
  const ms = Date.parse(hasZone ? value : `${value}Z`);
  return Number.isFinite(ms) ? ms : null;
}

function side(price: number, date: string): { price: number | null; at: number | null } {
  const at = parseApiDate(date);
  if (!(price > 0) || at === null) return { price: null, at: null };
  return { price, at };
}

/**
 * Converts an API price row into a Quote. Only the highest buy order and lowest sell order are used —
 * buy_price_min / sell_price_max are dominated by troll orders and are meaningless for trading.
 * Returns null for non-royal locations or rows without any usable price.
 */
export function normalizePriceRow(row: PriceRow): Quote | null {
  const city = toRoyalCity(row.city);
  if (!city) return null;
  const sell = side(row.sell_price_min, row.sell_price_min_date);
  const buy = side(row.buy_price_max, row.buy_price_max_date);
  if (sell.price === null && buy.price === null) return null;
  return {
    itemId: row.item_id,
    quality: row.quality,
    city,
    sellMin: sell.price,
    sellMinAt: sell.at,
    buyMax: buy.price,
    buyMaxAt: buy.at,
  };
}

export function ageMinutes(at: number | null, now: number): number | null {
  if (at === null) return null;
  return Math.max(0, (now - at) / 60_000);
}
