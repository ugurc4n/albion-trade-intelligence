import { matchesItemQuery, type CatalogItem } from "@/lib/catalog/types";
import {
  SCENARIOS,
  calculateProfit,
  scenarioId,
  suggestedBuyOrderPrice,
  suggestedSellOrderPrice,
  type Scenario,
} from "@/lib/profit/engine";
import { quoteKey, type Quote, type VolumeStats } from "@/lib/market/types";
import { RISK_PARAMS } from "@/lib/scoring/risk-params";
import { EXTREME_ROI, HIGH_VOLATILITY, LOW_VOLUME_PER_DAY, isPriceOutlier, scoreOpportunity } from "@/lib/scoring/score";
import type { Filters, Settings } from "@/lib/settings/schema";
import type { Opportunity, OpportunityFlag, RiskLevel } from "./types";

export type MarketData = {
  /** groupKey(itemId, quality) → quotes for the cities that have data. */
  quotesByGroup: Map<string, Quote[]>;
  /** quoteKey(itemId, quality, city) → 7-day volume stats. */
  volume: Map<string, VolumeStats>;
};

export type ScanContext = {
  settings: Settings;
  filters: Filters;
  now: number;
  getItem: (id: string) => CatalogItem | undefined;
};

type Side = { price: number; at: number };

/** Without any observed sales we never suggest more than a handful of units. */
export const UNKNOWN_VOLUME_MAX_QTY = 10;

function buySide(src: Quote, mode: Scenario["buy"]): Side | null {
  if (mode === "instant") return src.sellMin !== null && src.sellMinAt !== null ? { price: src.sellMin, at: src.sellMinAt } : null;
  return src.buyMax !== null && src.buyMaxAt !== null
    ? { price: suggestedBuyOrderPrice(src.buyMax), at: src.buyMaxAt }
    : null;
}

function sellSide(tgt: Quote, mode: Scenario["sell"]): Side | null {
  if (mode === "instant") return tgt.buyMax !== null && tgt.buyMaxAt !== null ? { price: tgt.buyMax, at: tgt.buyMaxAt } : null;
  return tgt.sellMin !== null && tgt.sellMinAt !== null
    ? { price: suggestedSellOrderPrice(tgt.sellMin), at: tgt.sellMinAt }
    : null;
}

function itemMatches(item: CatalogItem, quality: number, f: Filters): boolean {
  if (f.itemId && item.id !== f.itemId) return false;
  if (f.tiers.length && !f.tiers.includes(item.tier)) return false;
  if (f.enchants.length && !f.enchants.includes(item.enchant)) return false;
  if (f.categories.length && !f.categories.includes(item.category)) return false;
  if (f.qualities.length && !f.qualities.includes(quality)) return false;
  if (f.search.trim() && !matchesItemQuery(item, f.search)) return false;
  return true;
}

/** Builds one opportunity for a given source/target quote pair and scenario, or null if prices are missing. */
export function buildOpportunity(
  kind: "flip" | "trade",
  item: CatalogItem,
  src: Quote,
  tgt: Quote,
  scenario: Scenario,
  volume: Map<string, VolumeStats>,
  ctx: ScanContext,
): Opportunity | null {
  const buy = buySide(src, scenario.buy);
  const sell = sellSide(tgt, scenario.sell);
  if (!buy || !sell) return null;

  const { settings, filters, now } = ctx;
  const params = RISK_PARAMS[settings.riskPreference];
  const maxAge = filters.maxDataAgeMinutes ?? settings.maxDataAgeMinutes;

  const transportPerUnit = kind === "trade" ? item.weight * settings.transportCostPerKg : 0;
  const profit = calculateProfit({
    buyPrice: buy.price,
    sellPrice: sell.price,
    scenario,
    premium: settings.premium,
    fees: settings.fees,
    transportPerUnit,
  });

  const srcStats = volume.get(quoteKey(item.id, src.quality, src.city)) ?? null;
  const tgtStats = volume.get(quoteKey(item.id, tgt.quality, tgt.city)) ?? null;
  const srcVol = srcStats?.avgDailyVolume ?? null;
  const tgtVol = tgtStats?.avgDailyVolume ?? null;

  // Liquidity that matters: the target market always; the source market too when we rely on our buy order filling.
  const needsSrc = scenario.buy === "order";
  const limitingVol = tgtVol === null || (needsSrc && srcVol === null) ? null : needsSrc ? Math.min(tgtVol, srcVol!) : tgtVol;
  const volatilities = [tgtStats?.volatility, needsSrc ? srcStats?.volatility : undefined].filter(
    (v): v is number => typeof v === "number",
  );
  const volatility = volatilities.length ? Math.max(...volatilities) : null;
  const daysWithData = Math.min(tgtStats?.daysWithData ?? 0, needsSrc ? (srcStats?.daysWithData ?? 0) : Infinity);

  const dataAgeMinutes = Math.max(0, (now - Math.min(buy.at, sell.at)) / 60_000);

  const flags: OpportunityFlag[] = [];
  if (limitingVol === null) flags.push("no_volume");
  else if (limitingVol < LOW_VOLUME_PER_DAY) flags.push("low_volume");
  if (volatility !== null && volatility > HIGH_VOLATILITY) flags.push("volatile");
  if (isPriceOutlier(buy.price, srcStats?.avgPrice ?? null) || isPriceOutlier(sell.price, tgtStats?.avgPrice ?? null)) {
    flags.push("price_outlier");
  }
  if (profit.roi > EXTREME_ROI) flags.push("extreme_roi");
  if (dataAgeMinutes > maxAge) flags.push("stale");
  if (profit.upfrontPerUnit > settings.tradeBudget) flags.push("budget_exceeds");

  // Position sizing.
  const preRisk: RiskLevel =
    flags.includes("price_outlier") || flags.includes("extreme_roi") || (volatility ?? 0) > 0.3
      ? "high"
      : flags.includes("low_volume") || flags.includes("volatile")
        ? "medium"
        : "low";
  const budgetShare = limitingVol === null ? params.unknownVolumeShare : params.maxBudgetShare[preRisk];
  const caps = [(settings.tradeBudget * budgetShare) / profit.upfrontPerUnit];
  if (limitingVol !== null) {
    // Each order side (our buy order filling, our sell order filling) takes time; split the holding budget between them.
    const orderSides = (scenario.buy === "order" ? 1 : 0) + (scenario.sell === "order" ? 1 : 0);
    const volumeCap = (limitingVol * params.volumeShare * params.maxHoldDays) / Math.max(1, orderSides);
    caps.push(limitingVol > 0 ? Math.max(1, volumeCap) : 0);
  } else {
    caps.push(UNKNOWN_VOLUME_MAX_QTY);
  }
  if (kind === "trade" && settings.carryCapacityKg && item.weight > 0) caps.push(settings.carryCapacityKg / item.weight);
  if (filters.maxInvestment !== null && filters.maxInvestment > 0) caps.push(filters.maxInvestment / profit.upfrontPerUnit);
  const rawQty = Math.floor(Math.min(...caps));
  const recommendedQty = profit.unitProfit > 0 && Number.isFinite(rawQty) ? Math.max(0, rawQty) : 0;

  let estHoldDays: number | null = 0;
  if (recommendedQty > 0) {
    const share = params.volumeShare;
    if (scenario.buy === "order") estHoldDays = srcVol ? recommendedQty / (srcVol * share) : null;
    if (scenario.sell === "order" && estHoldDays !== null) estHoldDays = tgtVol ? estHoldDays + recommendedQty / (tgtVol * share) : null;
  }

  const potentialProfit = recommendedQty * profit.unitProfit;
  const { score, confidence, risk } = scoreOpportunity({
    roi: profit.roi,
    potentialProfit,
    tradeBudget: settings.tradeBudget,
    limitingDailyVolume: limitingVol,
    volatility,
    dataAgeMinutes,
    maxDataAgeMinutes: maxAge,
    estHoldDays,
    flags,
    daysWithData: Number.isFinite(daysWithData) ? daysWithData : 0,
  });

  const sid = scenarioId(scenario);
  return {
    id: `${kind}:${item.id}:${src.quality}:${src.city}:${tgt.city}:${sid}`,
    kind,
    itemId: item.id,
    quality: src.quality,
    name: item.nameEn,
    tier: item.tier,
    enchant: item.enchant,
    category: item.category,
    weight: item.weight,
    buyCity: src.city,
    sellCity: tgt.city,
    buyMode: scenario.buy,
    sellMode: scenario.sell,
    scenario: sid,
    sourceSellMin: src.sellMin,
    sourceBuyMax: src.buyMax,
    targetSellMin: tgt.sellMin,
    targetBuyMax: tgt.buyMax,
    profit,
    buyPriceAt: buy.at,
    sellPriceAt: sell.at,
    dataAgeMinutes,
    sourceDailyVolume: srcVol,
    targetDailyVolume: tgtVol,
    volatility,
    recommendedQty,
    requiredCapital: recommendedQty * profit.upfrontPerUnit,
    potentialProfit,
    estHoldDays,
    score,
    confidence,
    risk,
    flags,
  };
}

/** Post-scan filters that depend on computed values. */
export function passesResultFilters(o: Opportunity, ctx: ScanContext): boolean {
  const { filters, settings } = ctx;
  if (!filters.includeUnprofitable && o.profit.unitProfit <= 0) return false;
  if (!filters.includeStale && o.flags.includes("stale")) return false;
  const minRoi = filters.minRoi ?? settings.minRoi;
  if (!filters.includeUnprofitable && o.profit.roi < minRoi) return false;
  if (filters.minProfit !== null && o.profit.unitProfit < filters.minProfit) return false;
  if (filters.risks.length && !filters.risks.includes(o.risk)) return false;
  return true;
}

/** Market flipping: buy order → sell order inside one city, same item + quality. */
export function scanFlips(data: MarketData, ctx: ScanContext): Opportunity[] {
  const { filters } = ctx;
  if (filters.scenarios.length && !filters.scenarios.includes("order-order")) return [];
  const scenario: Scenario = { buy: "order", sell: "order" };
  const out: Opportunity[] = [];
  for (const quotes of data.quotesByGroup.values()) {
    const first = quotes[0];
    if (!first) continue;
    const item = ctx.getItem(first.itemId);
    if (!item || !itemMatches(item, first.quality, filters)) continue;
    for (const q of quotes) {
      if (filters.buyCity !== "all" && q.city !== filters.buyCity) continue;
      if (q.buyMax === null || q.sellMin === null) continue;
      if (!filters.includeUnprofitable && suggestedSellOrderPrice(q.sellMin) <= suggestedBuyOrderPrice(q.buyMax)) continue;
      const opp = buildOpportunity("flip", item, q, q, scenario, data.volume, ctx);
      if (opp && passesResultFilters(opp, ctx)) out.push(opp);
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** City-to-city trading across royal cities, all four buy/sell scenarios, exact item id + quality match. */
export function scanTrades(data: MarketData, ctx: ScanContext): Opportunity[] {
  const { filters } = ctx;
  const scenarios = SCENARIOS.filter((s) => !filters.scenarios.length || filters.scenarios.includes(scenarioId(s)));
  const out: Opportunity[] = [];
  for (const quotes of data.quotesByGroup.values()) {
    if (quotes.length < 2) continue;
    const first = quotes[0];
    const item = ctx.getItem(first.itemId);
    if (!item || !itemMatches(item, first.quality, filters)) continue;
    for (const src of quotes) {
      if (filters.buyCity !== "all" && src.city !== filters.buyCity) continue;
      const cheapestBuy = Math.min(src.sellMin ?? Infinity, src.buyMax !== null ? src.buyMax + 1 : Infinity);
      if (!Number.isFinite(cheapestBuy)) continue;
      for (const tgt of quotes) {
        if (tgt.city === src.city) continue;
        if (filters.sellCity !== "all" && tgt.city !== filters.sellCity) continue;
        const bestSell = Math.max(tgt.buyMax ?? 0, tgt.sellMin !== null ? tgt.sellMin - 1 : 0);
        if (!filters.includeUnprofitable && bestSell <= cheapestBuy) continue;
        for (const scenario of scenarios) {
          const opp = buildOpportunity("trade", item, src, tgt, scenario, data.volume, ctx);
          if (opp && passesResultFilters(opp, ctx)) out.push(opp);
        }
      }
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
