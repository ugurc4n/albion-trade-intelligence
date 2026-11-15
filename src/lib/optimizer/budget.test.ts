import { describe, expect, it } from "vitest";
import { calculateProfit } from "@/lib/profit/engine";
import { DEFAULT_FEES } from "@/lib/profit/fees";
import type { Opportunity } from "@/lib/scanner/types";
import { optimizeBasket } from "./budget";

function opp(overrides: Partial<Opportunity> & { id: string }, prices = { buy: 1000, sell: 1500 }): Opportunity {
  const profit = calculateProfit({
    buyPrice: prices.buy,
    sellPrice: prices.sell,
    scenario: { buy: "order", sell: "order" },
    premium: false,
    fees: DEFAULT_FEES,
  });
  return {
    kind: "flip",
    itemId: overrides.id,
    quality: 1,
    name: overrides.id,
    tier: 4,
    enchant: 0,
    category: "bags",
    weight: 1,
    buyCity: "Martlock",
    sellCity: "Martlock",
    buyMode: "order",
    sellMode: "order",
    scenario: "order-order",
    sourceSellMin: prices.sell,
    sourceBuyMax: prices.buy,
    targetSellMin: prices.sell,
    targetBuyMax: prices.buy,
    profit,
    buyPriceAt: 0,
    sellPriceAt: 0,
    dataAgeMinutes: 5,
    sourceDailyVolume: 1000,
    targetDailyVolume: 1000,
    volatility: 0.05,
    recommendedQty: 100_000,
    requiredCapital: 0,
    potentialProfit: 0,
    estHoldDays: 1,
    score: 80,
    confidence: "high",
    risk: "low",
    flags: [],
    ...overrides,
  };
}

const options = { budget: 3_000_000, totalSilver: 14_000_000, riskPreference: "balanced" as const };

describe("optimizeBasket", () => {
  it("never puts the whole budget into one product", () => {
    const basket = optimizeBasket([opp({ id: "A" })], options);
    expect(basket.lines).toHaveLength(1);
    expect(basket.lines[0].capital).toBeLessThanOrEqual(3_000_000 * 0.25);
    expect(basket.unusedBudget).toBeGreaterThan(0);
  });

  it("allocates less to high-risk and unknown-volume opportunities", () => {
    const basket = optimizeBasket(
      [
        opp({ id: "LOW", score: 90 }),
        opp({ id: "HIGH", score: 80, risk: "high" }),
        opp({ id: "UNKNOWN", score: 70, risk: "high", flags: ["no_volume"] }),
      ],
      options,
    );
    const cap = (id: string) => basket.lines.find((l) => l.opportunity.itemId === id)!.capital;
    expect(cap("HIGH")).toBeLessThan(cap("LOW"));
    expect(cap("UNKNOWN")).toBeLessThan(cap("HIGH"));
    expect(cap("UNKNOWN")).toBeLessThanOrEqual(3_000_000 * 0.04);
  });

  it("includes all fees in the invested capital and reports totals consistently", () => {
    const o = opp({ id: "A", recommendedQty: 10 });
    const basket = optimizeBasket([o], options);
    const line = basket.lines[0];
    expect(line.quantity).toBe(10);
    expect(line.capital).toBeCloseTo(10 * o.profit.upfrontPerUnit);
    expect(o.profit.upfrontPerUnit).toBeGreaterThan(1000); // purchase + setup fees
    expect(basket.totalInvestment + basket.unusedBudget).toBeCloseTo(3_000_000);
    expect(basket.estimatedProfit).toBeCloseTo(10 * o.profit.unitProfit);
    expect(basket.reservedCapital).toBe(11_000_000);
  });

  it("skips stale, anomalous and unprofitable opportunities and keeps one position per item", () => {
    const basket = optimizeBasket(
      [
        opp({ id: "STALE", flags: ["stale"] }),
        opp({ id: "OUTLIER", flags: ["price_outlier"] }),
        opp({ id: "LOSS" }, { buy: 1000, sell: 1000 }),
        opp({ id: "DUP", score: 90 }),
        { ...opp({ id: "DUP", score: 85 }), id: "DUP-2", quality: 2 },
      ],
      options,
    );
    expect(basket.lines.map((l) => l.opportunity.id)).toEqual(["DUP"]);
  });

  it("respects order book depth limits and the remaining budget", () => {
    const depth = new Map([["A", 3]]);
    const basket = optimizeBasket([opp({ id: "A" })], { ...options, depthLimits: depth });
    expect(basket.lines[0].quantity).toBe(3);
    expect(basket.lines[0].limitedBy).toContain("orderbook_depth");

    const tiny = optimizeBasket([opp({ id: "A" }), opp({ id: "B", score: 70 })], { ...options, budget: 1500 });
    expect(tiny.totalInvestment).toBeLessThanOrEqual(1500);
  });
});
