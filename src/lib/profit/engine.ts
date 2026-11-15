import { salesTaxRate, type FeeConfig } from "./fees";

/** "instant" = take an existing order (instant buy from a sell order / instant sell into a buy order). "order" = place your own order. */
export type TradeMode = "instant" | "order";

export type Scenario = { buy: TradeMode; sell: TradeMode };

export const SCENARIOS: Scenario[] = [
  { buy: "instant", sell: "order" },
  { buy: "order", sell: "order" },
  { buy: "order", sell: "instant" },
  { buy: "instant", sell: "instant" },
];

export const scenarioId = (s: Scenario) => `${s.buy}-${s.sell}` as const;
export type ScenarioId = ReturnType<typeof scenarioId>;

export const SCENARIO_LABELS: Record<ScenarioId, string> = {
  "instant-order": "Instant Buy → Sell Order",
  "order-order": "Buy Order → Sell Order",
  "order-instant": "Buy Order → Instant Sell",
  "instant-instant": "Instant Buy → Instant Sell",
};

export type ProfitInput = {
  /** Price paid per unit: the source sell order price (instant) or your own buy order price (order). */
  buyPrice: number;
  /** Price received per unit before deductions: the target buy order price (instant) or your own sell order price (order). */
  sellPrice: number;
  scenario: Scenario;
  premium: boolean;
  fees: FeeConfig;
  /** Transport cost per unit in silver (user assumption, 0 by default). */
  transportPerUnit?: number;
};

export type ProfitResult = {
  buyPrice: number;
  sellPrice: number;
  buySetupFee: number;
  sellSetupFee: number;
  relistCost: number;
  salesTax: number;
  transport: number;
  /** Cost of acquiring one unit including the buy-order setup fee. */
  unitCost: number;
  /** Silver tied up per unit before any sale: unit cost + sell-order setup fee + relists + transport. */
  upfrontPerUnit: number;
  /** Net silver received per unit after tax, setup fee, relists and transport. */
  unitRevenue: number;
  unitProfit: number;
  /** unitProfit / upfrontPerUnit */
  roi: number;
  /** Minimum sell price (before deductions) at which this trade does not lose silver. */
  breakEvenSellPrice: number;
};

export function calculateProfit(input: ProfitInput): ProfitResult {
  const { buyPrice, sellPrice, scenario, premium, fees } = input;
  const transport = Math.max(0, input.transportPerUnit ?? 0);
  const taxRate = salesTaxRate(fees, premium);

  const buySetupFee = scenario.buy === "order" ? buyPrice * fees.setupFeeRate : 0;
  const sellIsOrder = scenario.sell === "order";
  const sellSetupFee = sellIsOrder ? sellPrice * fees.setupFeeRate : 0;
  const relistCost = sellIsOrder ? sellPrice * fees.setupFeeRate * Math.max(0, fees.expectedRelists) : 0;
  const salesTax = sellPrice * taxRate;

  const unitCost = buyPrice + buySetupFee;
  const upfrontPerUnit = unitCost + sellSetupFee + relistCost + transport;
  const unitRevenue = sellPrice - salesTax;
  const unitProfit = unitRevenue - upfrontPerUnit;
  const roi = upfrontPerUnit > 0 ? unitProfit / upfrontPerUnit : 0;

  const deductionRate = taxRate + (sellIsOrder ? fees.setupFeeRate * (1 + Math.max(0, fees.expectedRelists)) : 0);
  const breakEvenSellPrice = deductionRate < 1 ? (unitCost + transport) / (1 - deductionRate) : Infinity;

  return {
    buyPrice,
    sellPrice,
    buySetupFee,
    sellSetupFee,
    relistCost,
    salesTax,
    transport,
    unitCost,
    upfrontPerUnit,
    unitRevenue,
    unitProfit,
    roi,
    breakEvenSellPrice,
  };
}

/** Suggested price for a new buy order: outbid the current best buy order by 1 silver. */
export function suggestedBuyOrderPrice(currentBuyMax: number): number {
  return currentBuyMax + 1;
}

/** Suggested price for a new sell order: undercut the current cheapest sell order by 1 silver. */
export function suggestedSellOrderPrice(currentSellMin: number): number {
  return Math.max(1, currentSellMin - 1);
}
