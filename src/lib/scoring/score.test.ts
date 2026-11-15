import { describe, expect, it } from "vitest";
import { isPriceOutlier, scoreOpportunity, type ScoreInput } from "./score";

const base: ScoreInput = {
  roi: 0.15,
  potentialProfit: 100_000,
  tradeBudget: 3_000_000,
  limitingDailyVolume: 500,
  volatility: 0.05,
  dataAgeMinutes: 10,
  maxDataAgeMinutes: 120,
  estHoldDays: 1,
  flags: [],
  daysWithData: 7,
};

describe("scoreOpportunity", () => {
  it("does not let a high ROI on an illiquid item beat a solid liquid trade", () => {
    const illiquid = scoreOpportunity({
      ...base,
      roi: 0.8,
      potentialProfit: 20_000,
      limitingDailyVolume: 1,
      estHoldDays: 6,
      volatility: 0.25,
      flags: ["low_volume", "volatile"],
    });
    const liquid = scoreOpportunity(base);
    expect(liquid.score).toBeGreaterThan(illiquid.score);
    expect(liquid.risk).toBe("low");
    expect(illiquid.risk).not.toBe("low");
  });

  it("never gives high confidence or a score above 40 without volume data", () => {
    const r = scoreOpportunity({ ...base, limitingDailyVolume: null, flags: ["no_volume"] });
    expect(r.confidence).toBe("low");
    expect(r.score).toBeLessThanOrEqual(40);
    expect(r.risk).toBe("high");
  });

  it("gives high confidence only for fresh, liquid, stable data", () => {
    expect(scoreOpportunity(base).confidence).toBe("high");
    expect(scoreOpportunity({ ...base, dataAgeMinutes: 50 }).confidence).toBe("medium");
    expect(scoreOpportunity({ ...base, dataAgeMinutes: 100 }).confidence).toBe("low");
  });

  it("penalises extreme ROI and stale data", () => {
    const normal = scoreOpportunity(base).score;
    expect(scoreOpportunity({ ...base, roi: 2, flags: ["extreme_roi"] }).score).toBeLessThan(normal);
    expect(scoreOpportunity({ ...base, flags: ["stale"] }).score).toBeLessThan(normal);
  });

  it("fresher data scores higher", () => {
    expect(scoreOpportunity({ ...base, dataAgeMinutes: 5 }).score).toBeGreaterThan(
      scoreOpportunity({ ...base, dataAgeMinutes: 90 }).score,
    );
  });
});

describe("isPriceOutlier", () => {
  it("flags prices far from the historical average", () => {
    expect(isPriceOutlier(100, 1000)).toBe(true);
    expect(isPriceOutlier(2500, 1000)).toBe(true);
    expect(isPriceOutlier(1100, 1000)).toBe(false);
    expect(isPriceOutlier(100, null)).toBe(false);
  });
});
