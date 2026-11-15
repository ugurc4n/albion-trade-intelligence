import { RISK_PARAMS } from "@/lib/scoring/risk-params";
import type { RiskPreference } from "@/lib/settings/schema";
import type { Opportunity } from "@/lib/scanner/types";

export type BasketLine = {
  opportunity: Opportunity;
  quantity: number;
  /** quantity × upfront cost per unit (purchase + buy/sell setup fees + relists + transport). */
  capital: number;
  estimatedProfit: number;
  /** Limits that bound the quantity, for display. */
  limitedBy: ("budget_share" | "remaining_budget" | "liquidity" | "orderbook_depth")[];
};

export type Basket = {
  lines: BasketLine[];
  budget: number;
  totalInvestment: number;
  estimatedProfit: number;
  unusedBudget: number;
  /** Total silver − trade budget: never touched by the optimizer. */
  reservedCapital: number;
};

export type BasketOptions = {
  budget: number;
  totalSilver: number;
  riskPreference: RiskPreference;
  maxPositions?: number;
  /** Optional per-opportunity quantity limits from order book depth (opportunity id → max units). */
  depthLimits?: Map<string, number>;
};

/** Eligibility for the basket: profitable, actionable and not flagged as unreliable. */
export function isBasketEligible(o: Opportunity): boolean {
  return (
    o.profit.unitProfit > 0 &&
    o.recommendedQty > 0 &&
    !o.flags.includes("stale") &&
    !o.flags.includes("price_outlier") &&
    !o.flags.includes("extreme_roi")
  );
}

/**
 * Greedy, score-ordered allocation with diversification:
 * - one position per item id (best-scored quality/route wins),
 * - each position capped by a risk-dependent share of the budget (smaller for risky / unknown-volume items),
 * - all fees are included in the capital requirement,
 * - quantities never exceed the liquidity-based recommendation (or order book depth when known).
 * Profits are estimates — fills are never guaranteed.
 */
export function optimizeBasket(opportunities: Opportunity[], options: BasketOptions): Basket {
  const { budget, riskPreference, maxPositions = 12, depthLimits } = options;
  const params = RISK_PARAMS[riskPreference];

  const candidates = opportunities.filter(isBasketEligible).sort((a, b) => b.score - a.score);
  const usedItems = new Set<string>();
  const lines: BasketLine[] = [];
  let remaining = budget;

  for (const o of candidates) {
    if (lines.length >= maxPositions || remaining <= 0) break;
    // One position per item id (across qualities and routes) to keep the basket diversified.
    const itemKey = o.itemId;
    if (usedItems.has(itemKey)) continue;

    const unit = o.profit.upfrontPerUnit;
    if (unit <= 0 || unit > remaining) continue;

    const share = o.flags.includes("no_volume") ? params.unknownVolumeShare : params.maxBudgetShare[o.risk];
    const shareCap = Math.floor((budget * share) / unit);
    const remainingCap = Math.floor(remaining / unit);
    const depthCap = depthLimits?.get(o.id);

    const limits: { qty: number; reason: BasketLine["limitedBy"][number] }[] = [
      { qty: shareCap, reason: "budget_share" },
      { qty: remainingCap, reason: "remaining_budget" },
      { qty: o.recommendedQty, reason: "liquidity" },
    ];
    if (depthCap !== undefined) limits.push({ qty: depthCap, reason: "orderbook_depth" });

    const quantity = Math.min(...limits.map((l) => l.qty));
    if (quantity < 1) continue;

    const capital = quantity * unit;
    lines.push({
      opportunity: o,
      quantity,
      capital,
      estimatedProfit: quantity * o.profit.unitProfit,
      limitedBy: limits.filter((l) => l.qty === quantity).map((l) => l.reason),
    });
    usedItems.add(itemKey);
    remaining -= capital;
  }

  const totalInvestment = lines.reduce((s, l) => s + l.capital, 0);
  return {
    lines,
    budget,
    totalInvestment,
    estimatedProfit: lines.reduce((s, l) => s + l.estimatedProfit, 0),
    unusedBudget: budget - totalInvestment,
    reservedCapital: Math.max(0, options.totalSilver - budget),
  };
}
