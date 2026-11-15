import type { City } from "@/lib/albion/constants";
import type { CatalogItem } from "@/lib/catalog/types";
import type { Quote, VolumeStats } from "@/lib/market/types";
import { groupKey, quoteKey } from "@/lib/market/types";
import type { MarketData, ScanContext } from "@/lib/scanner/scan";
import { DEFAULT_FILTERS, DEFAULT_SETTINGS, type Filters, type Settings } from "@/lib/settings/schema";

export const NOW = Date.UTC(2026, 10, 14, 18, 0, 0);
export const minutesAgo = (m: number) => NOW - m * 60_000;

export function item(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: "T4_BAG",
    nameEn: "Adept's Bag",
    nameTr: "Usta Çantası",
    tier: 4,
    enchant: 0,
    category: "bags",
    subcategory: "bags",
    weight: 3.4,
    maxQuality: 5,
    ...overrides,
  };
}

export function quote(city: City, overrides: Partial<Quote> = {}): Quote {
  return {
    itemId: "T4_BAG",
    quality: 1,
    city,
    sellMin: 1000,
    sellMinAt: minutesAgo(10),
    buyMax: 800,
    buyMaxAt: minutesAgo(10),
    ...overrides,
  };
}

export function volume(overrides: Partial<VolumeStats> = {}): VolumeStats {
  return {
    avgDailyVolume: 200,
    avgPrice: 1000,
    volatility: 0.05,
    daysWithData: 7,
    windowDays: 7,
    lastTimestamp: minutesAgo(60 * 12),
    ...overrides,
  };
}

export function marketData(quotes: Quote[], volumes: [Quote, VolumeStats][] = []): MarketData {
  const quotesByGroup = new Map<string, Quote[]>();
  for (const q of quotes) {
    const key = groupKey(q.itemId, q.quality);
    quotesByGroup.set(key, [...(quotesByGroup.get(key) ?? []), q]);
  }
  const vol = new Map<string, VolumeStats>();
  for (const [q, v] of volumes) vol.set(quoteKey(q.itemId, q.quality, q.city), v);
  return { quotesByGroup, volume: vol };
}

export function scanContext(
  items: CatalogItem[],
  settings: Partial<Settings> = {},
  filters: Partial<Filters> = {},
): ScanContext {
  const byId = new Map(items.map((i) => [i.id, i]));
  return {
    settings: { ...DEFAULT_SETTINGS, ...settings },
    filters: { ...DEFAULT_FILTERS, ...filters },
    now: NOW,
    getItem: (id) => byId.get(id),
  };
}
