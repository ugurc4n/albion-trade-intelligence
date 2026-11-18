/** Client-side fetch helpers for our own route handlers (never the Albion API directly). */
import type { OpportunitiesResponse } from "@/lib/opportunities";
import type { CatalogItem } from "@/lib/catalog/types";
import type { PlayerResponse, PlayerSummary } from "@/lib/killboard/types";
import type { HistorySeries, OrderbookEntry } from "@/lib/albion/schemas";
import type { Quote } from "@/lib/market/types";
import type { Filters, OpportunitiesRequest, Settings } from "@/lib/settings/schema";

export class ClientApiError extends Error {
  constructor(
    message: string,
    public readonly kind: string,
    public readonly status: number,
    public readonly retryAt?: number,
  ) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  let body: { error?: { kind?: string; message?: string; retryAt?: number } } = {};
  try {
    body = await res.json();
  } catch {
    // non-JSON error body
  }
  throw new ClientApiError(
    body.error?.message ?? `Server error (HTTP ${res.status})`,
    body.error?.kind ?? "unknown",
    res.status,
    body.error?.retryAt,
  );
}

export async function fetchOpportunities(
  args: { settings: Settings; filters: Filters; kind: OpportunitiesRequest["kind"]; limit: number },
  signal?: AbortSignal,
): Promise<OpportunitiesResponse> {
  const res = await fetch("/api/opportunities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
    signal,
  });
  return handle<OpportunitiesResponse>(res);
}

type Part<T> = T | { error: string };

export type ItemDetailResponse = {
  item: CatalogItem;
  server: string;
  inScanUniverse: boolean;
  prices: Part<{ rows: Quote[]; fetchedAt: number }>;
  history: Part<{ series: HistorySeries[]; fetchedAt: number }>;
  orderbook: Part<{ entries: OrderbookEntry[]; fetchedAt: number }>;
};

export async function fetchItemDetail(itemId: string, server: string, signal?: AbortSignal): Promise<ItemDetailResponse> {
  const res = await fetch(`/api/items/${encodeURIComponent(itemId)}?server=${server}`, { signal });
  return handle<ItemDetailResponse>(res);
}

export type CatalogSearchItem = Pick<CatalogItem, "id" | "nameTr" | "nameEn" | "tier" | "enchant" | "category">;

export async function searchItems(q: string, signal?: AbortSignal): Promise<CatalogSearchItem[]> {
  const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(q)}`, { signal });
  return (await handle<{ items: CatalogSearchItem[] }>(res)).items;
}

export function isPart<T extends object>(part: Part<T>): part is T {
  return !("error" in part);
}

export async function searchPlayers(q: string, server: string, signal?: AbortSignal): Promise<PlayerSummary[]> {
  const res = await fetch(`/api/players/search?q=${encodeURIComponent(q)}&server=${server}`, { signal });
  return (await handle<{ players: PlayerSummary[] }>(res)).players;
}

export async function fetchPlayer(id: string, server: string, signal?: AbortSignal): Promise<PlayerResponse> {
  const res = await fetch(`/api/players/${encodeURIComponent(id)}?server=${server}`, { signal });
  return handle<PlayerResponse>(res);
}
