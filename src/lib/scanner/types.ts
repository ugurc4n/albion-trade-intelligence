import type { City } from "@/lib/albion/constants";
import type { ProfitResult, ScenarioId, TradeMode } from "@/lib/profit/engine";

export type RiskLevel = "low" | "medium" | "high";
export type Confidence = "high" | "medium" | "low";

export type OpportunityFlag =
  | "no_volume" // no history data for a side that needs it
  | "low_volume" // fewer than ~5 sales/day observed
  | "volatile" // daily price CV above 20%
  | "price_outlier" // a used price deviates strongly from its 7-day average
  | "extreme_roi" // ROI above 150% — usually stale or troll orders
  | "stale" // a used price is older than the max data age
  | "budget_exceeds"; // a single unit costs more than the trade budget

export type Opportunity = {
  id: string;
  kind: "flip" | "trade";
  itemId: string;
  quality: number;
  name: string;
  tier: number;
  enchant: number;
  category: string;
  weight: number;

  buyCity: City;
  sellCity: City;
  buyMode: TradeMode;
  sellMode: TradeMode;
  scenario: ScenarioId;

  /** Current market references (null when no data). */
  sourceSellMin: number | null;
  sourceBuyMax: number | null;
  targetSellMin: number | null;
  targetBuyMax: number | null;

  profit: ProfitResult;

  /** Timestamps (epoch ms) of the two prices this opportunity relies on. */
  buyPriceAt: number;
  sellPriceAt: number;
  /** Age in minutes of the older of the two prices. */
  dataAgeMinutes: number;

  /** Observed average daily sales (history item_count); null = unknown. */
  sourceDailyVolume: number | null;
  targetDailyVolume: number | null;
  volatility: number | null;

  recommendedQty: number;
  requiredCapital: number;
  potentialProfit: number;
  /** Rough days until the position is filled/sold under the market-share assumption; null = unknown. */
  estHoldDays: number | null;

  score: number;
  confidence: Confidence;
  risk: RiskLevel;
  flags: OpportunityFlag[];
};
