/** Server-only orchestration: snapshot → scan → order-book check → basket. */
import { toMarketLocation, type ServerId } from "@/lib/albion/constants";
import { getCatalogItem } from "@/lib/catalog/catalog";
import { getMarketSnapshot, getOrderbooks, type SnapshotMeta } from "@/lib/market/service";
import { depthNearPrice } from "@/lib/market/orderbook";
import { isBasketEligible, optimizeBasket, type Basket } from "@/lib/optimizer/budget";
import { scanBlackMarket, scanFlips, scanTrades, type ScanContext } from "@/lib/scanner/scan";
import type { Opportunity } from "@/lib/scanner/types";
import type { OpportunitiesRequest } from "@/lib/settings/schema";

export type OpportunityList = {
  total: number;
  items: Opportunity[];
  /** Opportunities left out only because a price is older than the data-age limit (0 when stale ones are shown). */
  hiddenStale: number;
  /** Fresh opportunities from the other buy cities, when one buy city is selected (null otherwise). */
  otherCities: number | null;
};

export type OpportunitiesResponse = {
  flips: OpportunityList;
  trades: OpportunityList;
  /** Only filled for kind "blackmarket"; never part of the basket or the summary. */
  blackMarket: OpportunityList;
  basket: Basket;
  summary: {
    opportunityCount: number;
    topPotentialProfit: number | null;
    staleExcluded: boolean;
  };
  orderbookChecked: boolean;
  meta: SnapshotMeta & { scannedAt: number; quoteCount: number };
};

const ORDERBOOK_CANDIDATES = 40;
const EMPTY_LIST: OpportunityList = { total: 0, items: [], hiddenStale: 0, otherCities: null };

/**
 * Units available at the quoted price for the instant side(s) of each opportunity, from the order book.
 * Returns null when the order book could not be loaded (it is an enhancement, never a requirement).
 */
async function instantDepths(server: ServerId, candidates: Opportunity[]): Promise<Map<string, number> | null> {
  if (!candidates.length) return new Map();
  try {
    const books = await getOrderbooks(server, candidates.map((o) => o.itemId));
    const depths = new Map<string, number>();
    for (const o of candidates) {
      const entries = books.get(o.itemId) ?? [];
      const find = (city: string) => entries.find((x) => x.quality === o.quality && toMarketLocation(x.city) === city);
      const limits: number[] = [];
      if (o.buyMode === "instant") {
        const e = find(o.buyCity);
        if (e) limits.push(depthNearPrice(e.sell, o.profit.buyPrice, "sell", o.buyPriceAt));
      }
      if (o.sellMode === "instant") {
        const e = find(o.sellCity);
        if (e) limits.push(depthNearPrice(e.buy, o.profit.sellPrice, "buy", o.sellPriceAt));
      }
      if (limits.length) depths.set(o.id, Math.min(...limits));
    }
    return depths;
  } catch {
    return null;
  }
}

export async function runOpportunities(req: OpportunitiesRequest): Promise<OpportunitiesResponse> {
  const { settings, filters, kind, limit } = req;
  const snapshot = await getMarketSnapshot(settings.server);
  const now = Date.now();
  const ctx: ScanContext = { settings, filters, now, getItem: getCatalogItem };
  const meta = { ...snapshot.meta, scannedAt: now, quoteCount: snapshot.quoteCount };

  // What the filters hid, so an empty table can say why: stale prices, or a quiet buy city.
  const withStale: ScanContext = { ...ctx, filters: { ...filters, includeStale: true } };
  const anyCity: ScanContext = { ...ctx, filters: { ...filters, buyCity: "all" } };
  const hidden = (scan: typeof scanFlips, shown: number) => (filters.includeStale ? 0 : scan(snapshot, withStale).length - shown);
  const elsewhere = (scan: typeof scanFlips, shown: number) => (filters.buyCity === "all" ? null : scan(snapshot, anyCity).length - shown);

  if (kind === "blackmarket") return runBlackMarket(req, ctx, snapshot, meta, hidden, elsewhere);

  const flips = kind === "trade" ? [] : scanFlips(snapshot, ctx);
  const trades = kind === "flip" ? [] : scanTrades(snapshot, ctx);

  const flipHints = kind === "trade" ? { hiddenStale: 0, otherCities: null } : { hiddenStale: hidden(scanFlips, flips.length), otherCities: elsewhere(scanFlips, flips.length) };
  const tradeHints = kind === "flip" ? { hiddenStale: 0, otherCities: null } : { hiddenStale: hidden(scanTrades, trades.length), otherCities: elsewhere(scanTrades, trades.length) };
  const combined = [...flips, ...trades].sort((a, b) => b.score - a.score);

  // Instant trades depend on the depth of the book at the quoted price; check the best candidates.
  const instantCandidates = combined
    .filter(isBasketEligible)
    .filter((o) => o.buyMode === "instant" || o.sellMode === "instant")
    .slice(0, ORDERBOOK_CANDIDATES);
  const depths = await instantDepths(settings.server, instantCandidates);
  const orderbookChecked = depths !== null && instantCandidates.length > 0;

  const basket = optimizeBasket(combined, {
    budget: settings.tradeBudget,
    totalSilver: settings.totalSilver,
    riskPreference: settings.riskPreference,
    depthLimits: depths ?? new Map(),
  });

  const actionable = combined.filter(isBasketEligible);
  return {
    flips: { total: flips.length, items: flips.slice(0, limit), ...flipHints },
    trades: { total: trades.length, items: trades.slice(0, limit), ...tradeHints },
    blackMarket: EMPTY_LIST,
    basket,
    summary: {
      opportunityCount: combined.length,
      topPotentialProfit: actionable.length ? Math.max(...actionable.map((o) => o.potentialProfit)) : null,
      staleExcluded: !filters.includeStale,
    },
    orderbookChecked,
    meta,
  };
}

/**
 * Black Market only. Black Market Buy Orders are often just a few units, so the best candidates get their
 * suggested quantity capped by the order book depth at the quoted prices.
 */
async function runBlackMarket(
  req: OpportunitiesRequest,
  ctx: ScanContext,
  snapshot: Awaited<ReturnType<typeof getMarketSnapshot>>,
  meta: OpportunitiesResponse["meta"],
  hidden: (scan: typeof scanFlips, shown: number) => number,
  elsewhere: (scan: typeof scanFlips, shown: number) => number | null,
): Promise<OpportunitiesResponse> {
  const { settings, filters, limit } = req;
  const found = scanBlackMarket(snapshot, ctx);

  const candidates = found.filter((o) => o.profit.unitProfit > 0 && o.recommendedQty > 0).slice(0, ORDERBOOK_CANDIDATES);
  const depths = await instantDepths(settings.server, candidates);
  const items = depths
    ? found.map((o) => {
        const depth = depths.get(o.id);
        if (depth === undefined) return o;
        const qty = Math.min(o.recommendedQty, Math.floor(depth));
        return {
          ...o,
          orderbookDepth: depth,
          recommendedQty: qty,
          requiredCapital: qty * o.profit.upfrontPerUnit,
          potentialProfit: qty * o.profit.unitProfit,
        };
      })
    : found;

  return {
    flips: EMPTY_LIST,
    trades: EMPTY_LIST,
    blackMarket: {
      total: items.length,
      items: items.slice(0, limit),
      hiddenStale: hidden(scanBlackMarket, items.length),
      otherCities: elsewhere(scanBlackMarket, items.length),
    },
    basket: optimizeBasket([], { budget: settings.tradeBudget, totalSilver: settings.totalSilver, riskPreference: settings.riskPreference }),
    summary: {
      opportunityCount: items.length,
      topPotentialProfit: null,
      staleExcluded: !filters.includeStale,
    },
    orderbookChecked: depths !== null && candidates.length > 0,
    meta,
  };
}
