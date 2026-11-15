import type { Confidence, OpportunityFlag, RiskLevel } from "@/lib/scanner/types";

export const EXTREME_ROI = 1.5;
export const LOW_VOLUME_PER_DAY = 5;
export const HIGH_VOLATILITY = 0.2;
const OUTLIER_LOW = 0.4;
const OUTLIER_HIGH = 2.0;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** True when a price is far away from its 7-day average sale price (likely stale, troll or mis-listed). */
export function isPriceOutlier(price: number, avgPrice: number | null): boolean {
  if (avgPrice === null || avgPrice <= 0) return false;
  const ratio = price / avgPrice;
  return ratio < OUTLIER_LOW || ratio > OUTLIER_HIGH;
}

export type ScoreInput = {
  roi: number;
  potentialProfit: number;
  tradeBudget: number;
  /** Volume of the side(s) that depend on market liquidity; null = unknown. */
  limitingDailyVolume: number | null;
  volatility: number | null;
  dataAgeMinutes: number;
  maxDataAgeMinutes: number;
  estHoldDays: number | null;
  flags: OpportunityFlag[];
  daysWithData: number;
};

export type ScoreResult = { score: number; confidence: Confidence; risk: RiskLevel };

/**
 * Multi-criteria score (0–100). ROI saturates at 40% and extreme ROI is penalised, so a "+80% ROI"
 * on an illiquid item never outranks a solid, liquid trade. Missing volume caps the score at 40.
 */
export function scoreOpportunity(input: ScoreInput): ScoreResult {
  const { flags } = input;
  const volumeKnown = input.limitingDailyVolume !== null;

  const profitRef = Math.max(10_000, input.tradeBudget * 0.05);
  const profitScore = clamp01(Math.log10(1 + Math.max(0, input.potentialProfit)) / Math.log10(1 + profitRef));
  const roiScore = input.roi <= 0 ? 0 : input.roi > EXTREME_ROI ? 0.3 : clamp01(input.roi / 0.4);
  const liquidityScore = volumeKnown ? clamp01(Math.log10(1 + (input.limitingDailyVolume ?? 0)) / 2) : 0.1;
  const freshnessScore = clamp01(1 - input.dataAgeMinutes / Math.max(1, input.maxDataAgeMinutes));
  const volatilityScore = input.volatility === null ? 0.4 : 1 - clamp01(input.volatility / 0.3);
  const lockScore = input.estHoldDays === null ? 0.3 : 1 / (1 + input.estHoldDays / 2);

  let score =
    100 *
    (0.25 * profitScore +
      0.15 * roiScore +
      0.2 * liquidityScore +
      0.15 * freshnessScore +
      0.1 * volatilityScore +
      0.15 * lockScore);

  if (flags.includes("price_outlier") || flags.includes("extreme_roi")) score *= 0.5;
  if (flags.includes("stale")) score *= 0.5;
  if (!volumeKnown) score = Math.min(score, 40);

  const risk = riskLevel(input);
  const confidence = confidenceLevel(input, volumeKnown);

  return { score: Math.round(score * 10) / 10, confidence, risk };
}

function riskLevel(input: ScoreInput): RiskLevel {
  const { flags } = input;
  if (
    input.limitingDailyVolume === null ||
    flags.includes("price_outlier") ||
    flags.includes("extreme_roi") ||
    flags.includes("stale") ||
    (input.volatility ?? 0) > 0.3 ||
    (input.estHoldDays ?? 0) > 7
  ) {
    return "high";
  }
  if (
    flags.includes("low_volume") ||
    flags.includes("volatile") ||
    input.volatility === null ||
    (input.estHoldDays ?? 0) > 3.5
  ) {
    return "medium";
  }
  return "low";
}

function confidenceLevel(input: ScoreInput, volumeKnown: boolean): Confidence {
  const { flags } = input;
  if (!volumeKnown || flags.includes("stale") || flags.includes("price_outlier") || flags.includes("extreme_roi")) {
    return "low";
  }
  if (
    input.daysWithData >= 4 &&
    input.dataAgeMinutes <= Math.min(30, input.maxDataAgeMinutes) &&
    !flags.includes("low_volume") &&
    !flags.includes("volatile")
  ) {
    return "high";
  }
  return input.dataAgeMinutes <= input.maxDataAgeMinutes / 2 ? "medium" : "low";
}
