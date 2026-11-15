import type { RiskPreference } from "@/lib/settings/schema";
import type { RiskLevel } from "@/lib/scanner/types";

export type RiskParams = {
  /** Share of observed daily volume we assume we can capture. */
  volumeShare: number;
  /** Longest acceptable holding period used to size positions. */
  maxHoldDays: number;
  /** Maximum share of the trade budget allocated to one position, per risk level. */
  maxBudgetShare: Record<RiskLevel, number>;
  /** Maximum budget share when volume data is missing entirely. */
  unknownVolumeShare: number;
};

export const RISK_PARAMS: Record<RiskPreference, RiskParams> = {
  conservative: {
    volumeShare: 0.1,
    maxHoldDays: 2,
    maxBudgetShare: { low: 0.2, medium: 0.1, high: 0.04 },
    unknownVolumeShare: 0.02,
  },
  balanced: {
    volumeShare: 0.15,
    maxHoldDays: 3,
    maxBudgetShare: { low: 0.25, medium: 0.15, high: 0.08 },
    unknownVolumeShare: 0.04,
  },
  aggressive: {
    volumeShare: 0.25,
    maxHoldDays: 5,
    maxBudgetShare: { low: 0.35, medium: 0.2, high: 0.12 },
    unknownVolumeShare: 0.06,
  },
};
