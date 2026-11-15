import { describe, expect, it } from "vitest";
import { calculateProfit, suggestedBuyOrderPrice, suggestedSellOrderPrice } from "./engine";
import { DEFAULT_FEES } from "./fees";

const fees = { ...DEFAULT_FEES, expectedRelists: 0 };

describe("calculateProfit", () => {
  it("instant buy → instant sell: no setup fees, only sales tax", () => {
    const r = calculateProfit({ buyPrice: 1000, sellPrice: 1200, scenario: { buy: "instant", sell: "instant" }, premium: false, fees });
    expect(r.buySetupFee).toBe(0);
    expect(r.sellSetupFee).toBe(0);
    expect(r.salesTax).toBeCloseTo(96); // 8% of 1200
    expect(r.unitCost).toBe(1000);
    expect(r.unitProfit).toBeCloseTo(1200 - 96 - 1000);
    expect(r.roi).toBeCloseTo(104 / 1000);
  });

  it("buy order → sell order: setup fee on both sides plus sales tax", () => {
    const r = calculateProfit({ buyPrice: 1000, sellPrice: 1500, scenario: { buy: "order", sell: "order" }, premium: false, fees });
    expect(r.buySetupFee).toBeCloseTo(25);
    expect(r.sellSetupFee).toBeCloseTo(37.5);
    expect(r.salesTax).toBeCloseTo(120);
    expect(r.unitCost).toBeCloseTo(1025);
    expect(r.upfrontPerUnit).toBeCloseTo(1062.5);
    expect(r.unitProfit).toBeCloseTo(1500 - 120 - 1062.5);
  });

  it("buy order → instant sell: only buy setup fee and sales tax", () => {
    const r = calculateProfit({ buyPrice: 1000, sellPrice: 1300, scenario: { buy: "order", sell: "instant" }, premium: true, fees });
    expect(r.buySetupFee).toBeCloseTo(25);
    expect(r.sellSetupFee).toBe(0);
    expect(r.salesTax).toBeCloseTo(52); // 4% premium
    expect(r.unitProfit).toBeCloseTo(1300 - 52 - 1025);
  });

  it("instant buy → sell order: only sell-side fees", () => {
    const r = calculateProfit({ buyPrice: 1000, sellPrice: 1300, scenario: { buy: "instant", sell: "order" }, premium: true, fees });
    expect(r.buySetupFee).toBe(0);
    expect(r.sellSetupFee).toBeCloseTo(32.5);
    expect(r.unitProfit).toBeCloseTo(1300 - 52 - 32.5 - 1000);
  });

  it("premium halves the sales tax compared to non-premium", () => {
    const base = { buyPrice: 1000, sellPrice: 2000, scenario: { buy: "instant", sell: "instant" } as const, fees };
    const premium = calculateProfit({ ...base, premium: true });
    const free = calculateProfit({ ...base, premium: false });
    expect(free.salesTax).toBeCloseTo(premium.salesTax * 2);
    expect(premium.unitProfit - free.unitProfit).toBeCloseTo(80);
  });

  it("relists re-pay the sell setup fee", () => {
    const r = calculateProfit({
      buyPrice: 1000,
      sellPrice: 2000,
      scenario: { buy: "instant", sell: "order" },
      premium: false,
      fees: { ...fees, expectedRelists: 2 },
    });
    expect(r.relistCost).toBeCloseTo(100); // 2 × 2.5% × 2000
  });

  it("transport cost reduces profit", () => {
    const r = calculateProfit({
      buyPrice: 1000,
      sellPrice: 2000,
      scenario: { buy: "instant", sell: "instant" },
      premium: false,
      fees,
      transportPerUnit: 50,
    });
    expect(r.transport).toBe(50);
    expect(r.unitProfit).toBeCloseTo(2000 - 160 - 1000 - 50);
  });

  it.each([
    [{ buy: "instant", sell: "instant" }, false],
    [{ buy: "order", sell: "order" }, false],
    [{ buy: "order", sell: "instant" }, true],
    [{ buy: "instant", sell: "order" }, true],
  ] as const)("break-even price yields zero profit (%o, premium=%s)", (scenario, premium) => {
    const params = { buyPrice: 1234, scenario, premium, fees: DEFAULT_FEES, transportPerUnit: 12 };
    const be = calculateProfit({ ...params, sellPrice: 2000 }).breakEvenSellPrice;
    const atBreakEven = calculateProfit({ ...params, sellPrice: be });
    expect(atBreakEven.unitProfit).toBeCloseTo(0, 6);
  });
});

describe("suggested order prices", () => {
  it("outbids the best buy order and undercuts the best sell order by 1", () => {
    expect(suggestedBuyOrderPrice(800)).toBe(801);
    expect(suggestedSellOrderPrice(1000)).toBe(999);
    expect(suggestedSellOrderPrice(1)).toBe(1);
  });
});
