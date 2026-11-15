import type { City } from "@/lib/albion/constants";

/** Normalized current-price quote for one item + quality in one city. Missing sides are null. */
export type Quote = {
  itemId: string;
  quality: number;
  city: City;
  /** Lowest sell order (what an instant buy costs). */
  sellMin: number | null;
  sellMinAt: number | null;
  /** Highest buy order (what an instant sell yields). */
  buyMax: number | null;
  buyMaxAt: number | null;
};

export type VolumeStats = {
  /** Average items sold per day over the window (days without data count as 0). Null when no history exists. */
  avgDailyVolume: number | null;
  /** Volume-weighted average sale price over the window. */
  avgPrice: number | null;
  /** Coefficient of variation of daily average prices; null with fewer than 3 data points. */
  volatility: number | null;
  daysWithData: number;
  windowDays: number;
  lastTimestamp: number | null;
};

export const quoteKey = (itemId: string, quality: number, city: string) => `${itemId}|${quality}|${city}`;
export const groupKey = (itemId: string, quality: number) => `${itemId}|${quality}`;
