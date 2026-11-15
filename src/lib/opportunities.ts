/** Server-only orchestration: snapshot → scan → order-book check → basket. */
import { getCatalogItem } from "@/lib/catalog/catalog";
import { getMarketSnapshot, getOrderbooks, type SnapshotMeta } from "@/lib/market/service";
import { depthNearPrice } from "@/lib/market/orderbook";
import { isBasketEligible, optimizeBasket, type Basket } from "@/lib/optimizer/budget";
import { scanFlips, scanTrades, type ScanContext } from "@/lib/scanner/scan";
import type { Opportunity } from "@/lib/scanner/types";
import type { OpportunitiesRequest } from "@/lib/settings/schema";

export type OpportunityList = { total: number; items: Opportunity[] };

export type OpportunitiesResponse = {
  flips: OpportunityList;
  trades: OpportunityList;
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

export async function runOpportunities(req: OpportunitiesRequest): Promise<OpportunitiesResponse> {
  const { settings, filters, kind, limit } = req;
  const snapshot = await getMarketSnapshot(settings.server);
  const now = Date.now();
  const ctx: ScanContext = { settings, filters, now, getItem: getCatalogItem };

  const flips = kind === "trade" ? [] : scanFlips(snapshot, ctx);
  const trades = kind === "flip" ? [] : scanTrades(snapshot, ctx);
  const combined = [...flips, ...trades].sort((a, b) => b.score - a.score);

  // Instant trades depend on the depth of the book at the quoted price; check the best candidates.
  const depthLimits = new Map<string, number>();
  let orderbookChecked = false;
  const instantCandidates = combined
    .filter(isBasketEligible)
    .filter((o) => o.buyMode === "instant" || o.sellMode === "instant")
    .slice(0, ORDERBOOK_CANDIDATES);
  if (instantCandidates.length) {
    try {
      const books = await getOrderbooks(settings.server, instantCandidates.map((o) => o.itemId));
      orderbookChecked = true;
      for (const o of instantCandidates) {
        const entries = books.get(o.itemId) ?? [];
        const limits: number[] = [];
        if (o.buyMode === "instant") {
          const e = entries.find((x) => x.quality === o.quality && x.city === o.buyCity);
          if (e) limits.push(depthNearPrice(e.sell, o.profit.buyPrice, "sell", o.buyPriceAt));
        }
        if (o.sellMode === "instant") {
          const e = entries.find((x) => x.quality === o.quality && x.city === o.sellCity);
          if (e) limits.push(depthNearPrice(e.buy, o.profit.sellPrice, "buy", o.sellPriceAt));
        }
        if (limits.length) depthLimits.set(o.id, Math.min(...limits));
      }
    } catch {
      // Order book is an enhancement; the basket still works with liquidity-based limits.
    }
  }

  const basket = optimizeBasket(combined, {
    budget: settings.tradeBudget,
    totalSilver: settings.totalSilver,
    riskPreference: settings.riskPreference,
    depthLimits,
  });

  const actionable = combined.filter(isBasketEligible);
  return {
    flips: { total: flips.length, items: flips.slice(0, limit) },
    trades: { total: trades.length, items: trades.slice(0, limit) },
    basket,
    summary: {
      opportunityCount: combined.length,
      topPotentialProfit: actionable.length ? Math.max(...actionable.map((o) => o.potentialProfit)) : null,
      staleExcluded: !filters.includeStale,
    },
    orderbookChecked,
    meta: { ...snapshot.meta, scannedAt: now, quoteCount: snapshot.quoteCount },
  };
}
