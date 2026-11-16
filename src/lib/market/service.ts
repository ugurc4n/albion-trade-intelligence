/**
 * Server-only market data service: batched, rate-limited, cached access to the Albion Data API.
 * Never import this from client components.
 */
import { AlbionApiError, AlbionClient } from "@/lib/albion/client";
import { chunkIds } from "@/lib/albion/batching";
import { CACHE_TTL, MAX_URL_LENGTH, ROYAL_CITIES, toRoyalCity, type ServerId } from "@/lib/albion/constants";
import { TtlCache } from "@/lib/albion/cache";
import type { HistorySeries, OrderbookEntry, PriceRow } from "@/lib/albion/schemas";
import { allCatalogItems } from "@/lib/catalog/catalog";
import { buildScanUniverse } from "@/lib/catalog/universe";
import { computeVolumeStats } from "./history";
import { normalizePriceRow } from "./normalize";
import { groupKey, quoteKey, type Quote, type VolumeStats } from "./types";
import type { MarketData } from "@/lib/scanner/scan";

type Services = { client: AlbionClient; cache: TtlCache; snapshots: Map<ServerId, SnapshotMemo> };
type SnapshotMemo = { signature: string; snapshot: MarketSnapshot };

// Survive dev-mode hot reloads: one limiter + cache per Node process.
const g = globalThis as unknown as { __albionServices?: Services };
function services(): Services {
  g.__albionServices ??= { client: new AlbionClient(), cache: new TtlCache(3000), snapshots: new Map() };
  return g.__albionServices;
}

const UNIVERSE = buildScanUniverse(allCatalogItems());
const DAY_MS = 86_400_000;
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

let universeChunks: string[][] | null = null;
function getUniverseChunks(): string[][] {
  // History URLs carry the most query parameters, so chunks sized for them fit every endpoint.
  universeChunks ??= chunkIds(
    UNIVERSE,
    (ids) =>
      AlbionClient.buildUrl("europe", "history", ids, {
        locations: ROYAL_CITIES.join(","),
        "time-scale": "24",
        date: "2026-01-01",
      }),
    MAX_URL_LENGTH,
  );
  return universeChunks;
}

export type ChunkStatus = { total: number; loaded: number; failed: number; oldestFetchAt: number | null; stale: boolean };

export type SnapshotMeta = {
  server: ServerId;
  universeSize: number;
  prices: ChunkStatus;
  history: ChunkStatus;
  errors: string[];
  rateLimitedUntil: number | null;
  builtAt: number;
};

export type MarketSnapshot = MarketData & { meta: SnapshotMeta; quoteCount: number };

function errorMessage(reason: unknown): string {
  if (reason instanceof AlbionApiError) return reason.message;
  if (reason instanceof Error) return reason.message;
  return String(reason);
}

function chunkStatus<T>(results: PromiseSettledResult<{ fetchedAt: number; stale: boolean; value: T }>[]): ChunkStatus {
  const ok = results.filter((r) => r.status === "fulfilled");
  return {
    total: results.length,
    loaded: ok.length,
    failed: results.length - ok.length,
    oldestFetchAt: ok.length ? Math.min(...ok.map((r) => r.value.fetchedAt)) : null,
    stale: ok.some((r) => r.value.stale),
  };
}

/** Loads (or serves from cache) current prices and 7-day volume for the whole scan universe. */
export async function getMarketSnapshot(server: ServerId): Promise<MarketSnapshot> {
  const { client, cache, snapshots } = services();
  const chunks = getUniverseChunks();
  const now = Date.now();

  const priceResults = await Promise.allSettled(
    chunks.map((ids, i) =>
      cache.get<PriceRow[]>(`prices:${server}:${i}`, CACHE_TTL.pricesMs, async () => {
        const res = await client.getPrices(server, ids, ROYAL_CITIES);
        return res.rows;
      }),
    ),
  );
  const historyResults = await Promise.allSettled(
    chunks.map((ids, i) =>
      cache.get<[string, VolumeStats][]>(`history:${server}:${i}`, CACHE_TTL.historyMs, async () => {
        const res = await client.getHistory(server, ids, ROYAL_CITIES, { timeScale: 24, date: isoDate(Date.now() - 8 * DAY_MS) });
        return volumeEntries(res.rows, Date.now());
      }),
    ),
  );

  const prices = chunkStatus(priceResults);
  const history = chunkStatus(historyResults);
  const errors = [...new Set([...priceResults, ...historyResults].flatMap((r) => (r.status === "rejected" ? [errorMessage(r.reason)] : [])))];
  for (const r of [...priceResults, ...historyResults]) {
    if (r.status === "fulfilled" && r.value.refreshError) errors.push(`Refresh failed (showing older data): ${r.value.refreshError}`);
  }

  if (prices.loaded === 0) {
    const first = priceResults.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    throw first?.reason ?? new Error("Could not load price data.");
  }

  const meta: SnapshotMeta = {
    server,
    universeSize: UNIVERSE.length,
    prices,
    history,
    errors: [...new Set(errors)],
    rateLimitedUntil: client.limiter.getPausedUntil(),
    builtAt: now,
  };

  // Re-use the assembled maps when no chunk changed since the last call.
  const signature = [...priceResults, ...historyResults]
    .map((r) => (r.status === "fulfilled" ? r.value.fetchedAt : "x"))
    .join(",");
  const memo = snapshots.get(server);
  if (memo && memo.signature === signature) return { ...memo.snapshot, meta };

  const quotesByGroup = new Map<string, Quote[]>();
  let quoteCount = 0;
  for (const r of priceResults) {
    if (r.status !== "fulfilled") continue;
    for (const row of r.value.value) {
      const quote = normalizePriceRow(row);
      if (!quote) continue;
      const key = groupKey(quote.itemId, quote.quality);
      const list = quotesByGroup.get(key);
      if (list) list.push(quote);
      else quotesByGroup.set(key, [quote]);
      quoteCount++;
    }
  }
  const volume = new Map<string, VolumeStats>();
  for (const r of historyResults) {
    if (r.status !== "fulfilled") continue;
    for (const [k, v] of r.value.value) volume.set(k, v);
  }

  const snapshot: MarketSnapshot = { quotesByGroup, volume, meta, quoteCount };
  snapshots.set(server, { signature, snapshot });
  return snapshot;
}

function volumeEntries(series: HistorySeries[], now: number): [string, VolumeStats][] {
  const out: [string, VolumeStats][] = [];
  for (const s of series) {
    const city = toRoyalCity(s.location);
    if (!city) continue;
    out.push([quoteKey(s.item_id, s.quality, city), computeVolumeStats(s.data, now)]);
  }
  return out;
}

/** Order books for a set of items, fetched in as few batched requests as possible and cached per item. */
export async function getOrderbooks(server: ServerId, itemIds: string[]): Promise<Map<string, OrderbookEntry[]>> {
  const { client, cache } = services();
  const result = new Map<string, OrderbookEntry[]>();
  const missing: string[] = [];
  const now = Date.now();
  for (const id of new Set(itemIds)) {
    const hit = cache.peek<OrderbookEntry[]>(`orderbook:${server}:${id}`);
    if (hit && now - hit.fetchedAt <= CACHE_TTL.orderbookMs) result.set(id, hit.value);
    else missing.push(id);
  }
  if (missing.length === 0) return result;

  const chunks = chunkIds(
    missing,
    (ids) => AlbionClient.buildUrl(server, "orderbook", ids, { locations: ROYAL_CITIES.join(",") }),
    MAX_URL_LENGTH,
  );
  const settled = await Promise.allSettled(chunks.map((ids) => client.getOrderbook(server, ids, ROYAL_CITIES)));
  settled.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    const byItem = new Map<string, OrderbookEntry[]>(chunks[i].map((id) => [id, []]));
    for (const entry of r.value.rows) byItem.get(entry.item_id)?.push(entry);
    for (const [id, entries] of byItem) {
      result.set(id, entries);
      cache.put(`orderbook:${server}:${id}`, entries);
    }
  });
  return result;
}

export type ItemDetailData = {
  prices: { rows: Quote[]; fetchedAt: number } | { error: string };
  history: { series: HistorySeries[]; fetchedAt: number } | { error: string };
  orderbook: { entries: OrderbookEntry[]; fetchedAt: number } | { error: string };
};

/** Current prices (all royal cities, all qualities), 30-day daily history and order book for one item. */
export async function getItemDetail(server: ServerId, itemId: string): Promise<ItemDetailData> {
  const { client, cache } = services();
  const [prices, history, orderbook] = await Promise.allSettled([
    cache.get(`item:prices:${server}:${itemId}`, CACHE_TTL.itemDetailMs, async () => {
      const res = await client.getPrices(server, [itemId], ROYAL_CITIES);
      return res.rows.map(normalizePriceRow).filter((q): q is Quote => q !== null);
    }),
    cache.get(`item:history:${server}:${itemId}`, CACHE_TTL.historyMs, async () => {
      const res = await client.getHistory(server, [itemId], ROYAL_CITIES, {
        timeScale: 24,
        date: isoDate(Date.now() - 30 * DAY_MS),
      });
      return res.rows;
    }),
    cache.get(`item:orderbook:${server}:${itemId}`, CACHE_TTL.orderbookMs, async () => {
      const res = await client.getOrderbook(server, [itemId], ROYAL_CITIES);
      return res.rows;
    }),
  ]);
  return {
    prices: prices.status === "fulfilled" ? { rows: prices.value.value, fetchedAt: prices.value.fetchedAt } : { error: errorMessage(prices.reason) },
    history:
      history.status === "fulfilled" ? { series: history.value.value, fetchedAt: history.value.fetchedAt } : { error: errorMessage(history.reason) },
    orderbook:
      orderbook.status === "fulfilled"
        ? { entries: orderbook.value.value, fetchedAt: orderbook.value.fetchedAt }
        : { error: errorMessage(orderbook.reason) },
  };
}

export function getServiceStatus() {
  const { client, cache } = services();
  return {
    limiter: client.limiter.status(),
    lastError: client.lastError,
    cacheEntries: cache.size(),
    universeSize: UNIVERSE.length,
    universeChunks: getUniverseChunks().length,
  };
}

const UNIVERSE_SET = new Set(UNIVERSE);
export function isInUniverse(itemId: string): boolean {
  return UNIVERSE_SET.has(itemId);
}
