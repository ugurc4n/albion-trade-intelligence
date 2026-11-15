import { z } from "zod";

/** Row returned by GET /api/v2/stats/prices/{ids}.json */
export const priceRowSchema = z.object({
  item_id: z.string(),
  city: z.string(),
  quality: z.number().int(),
  sell_price_min: z.number(),
  sell_price_min_date: z.string(),
  sell_price_max: z.number(),
  sell_price_max_date: z.string(),
  buy_price_min: z.number(),
  buy_price_min_date: z.string(),
  buy_price_max: z.number(),
  buy_price_max_date: z.string(),
});
export type PriceRow = z.infer<typeof priceRowSchema>;

/** Series returned by GET /api/v2/stats/history/{ids}.json */
export const historyPointSchema = z.object({
  item_count: z.number(),
  avg_price: z.number(),
  timestamp: z.string(),
});
export const historySeriesSchema = z.object({
  location: z.string(),
  item_id: z.string(),
  quality: z.number().int(),
  data: z.array(historyPointSchema),
});
export type HistoryPoint = z.infer<typeof historyPointSchema>;
export type HistorySeries = z.infer<typeof historySeriesSchema>;

/** Entry returned by GET /api/v2/stats/orderbook/{ids}.json — price levels aggregated, sell cheapest-first, buy richest-first. */
export const orderbookLevelSchema = z.object({
  price: z.number(),
  amount: z.number(),
  updated_at: z.string(),
});
export const orderbookEntrySchema = z.object({
  item_id: z.string(),
  city: z.string(),
  quality: z.number().int(),
  sell: z.array(orderbookLevelSchema),
  buy: z.array(orderbookLevelSchema),
});
export type OrderbookLevel = z.infer<typeof orderbookLevelSchema>;
export type OrderbookEntry = z.infer<typeof orderbookEntrySchema>;

/**
 * Validates an array response row by row: malformed rows are dropped (and counted) instead of
 * failing the whole batch. A non-array body is an invalid response.
 */
export function parseRows<T>(schema: z.ZodType<T>, body: unknown): { rows: T[]; invalid: number } | null {
  if (!Array.isArray(body)) return null;
  const rows: T[] = [];
  let invalid = 0;
  for (const item of body) {
    const parsed = schema.safeParse(item);
    if (parsed.success) rows.push(parsed.data);
    else invalid++;
  }
  return { rows, invalid };
}
