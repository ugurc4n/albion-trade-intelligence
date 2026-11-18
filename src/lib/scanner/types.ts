import type { MarketLocation } from "@/lib/albion/constants";
import type { ProfitResult, ScenarioId, TradeMode } from "@/lib/profit/engine";

/** flip = same Royal City, trade = Royal City → Royal City, blackmarket = Caerleon or a Royal City → Black Market. */
export type OpportunityKind = "flip" | "trade" | "blackmarket";

export type RiskLevel = "low" | "medium" | "high";
export type Confidence = "high" | "medium" | "low";

export type OpportunityFlag =
  | "no_volume" // no history data for a side that needs it
  | "low_volume" // fewer than ~5 sales/day observed
  | "volatile" // daily price CV above 20%
  | "price_outlier" // a used price deviates strongly from its 7-day average
  | "extreme_roi" // ROI above 150% — usually stale or troll orders
  | "stale" // a used price is older than the max data age
  | "budget_exceeds" // a single unit costs more than the trade budget
  | "red_zone_transport"; // Black Market run from a Royal City: the haul to Caerleon crosses red zones

export type Opportunity = {
  id: string;
  kind: OpportunityKind;
  itemId: string;
  quality: number;
  name: string;
  tier: number;
  enchant: number;
  category: string;
  weight: number;

  buyCity: MarketLocation;
  sellCity: MarketLocation;
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
  /** Units the order book shows at the quoted instant price(s); set only when it was checked and capped the quantity. */
  orderbookDepth?: number;
  requiredCapital: number;
  potentialProfit: number;
  /** Rough days until the position is filled/sold under the market-share assumption; null = unknown. */
  estHoldDays: number | null;

  score: number;
  confidence: Confidence;
  risk: RiskLevel;
  flags: OpportunityFlag[];
};
