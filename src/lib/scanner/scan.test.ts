import { describe, expect, it } from "vitest";
import { item, marketData, minutesAgo, quote, scanContext, volume } from "@/test/factories";
import { UNKNOWN_VOLUME_MAX_QTY, scanBlackMarket, scanFlips, scanTrades } from "./scan";

describe("scanFlips", () => {
  it("finds a buy order → sell order spread in one city with fees applied", () => {
    const q = quote("Martlock", { sellMin: 1500, buyMax: 1000 });
    const ctx = scanContext([item()]);
    const [opp] = scanFlips(marketData([q], [[q, volume()]]), ctx);
    expect(opp.kind).toBe("flip");
    expect(opp.scenario).toBe("order-order");
    expect(opp.profit.buyPrice).toBe(1001);
    expect(opp.profit.sellPrice).toBe(1499);
    // 1499 − 8% tax − 2.5% setup − 2.5% relist − (1001 × 1.025)
    expect(opp.profit.unitProfit).toBeCloseTo(1499 * (1 - 0.08 - 0.025 - 0.025) - 1001 * 1.025);
    expect(opp.recommendedQty).toBeGreaterThan(0);
  });

  it("hides negative-profit spreads by default and shows them on request", () => {
    const q = quote("Martlock", { sellMin: 1050, buyMax: 1000 });
    const data = marketData([q], [[q, volume()]]);
    expect(scanFlips(data, scanContext([item()]))).toHaveLength(0);
    const shown = scanFlips(data, scanContext([item()], {}, { includeUnprofitable: true }));
    expect(shown).toHaveLength(1);
    expect(shown[0].profit.unitProfit).toBeLessThan(0);
  });

  it("excludes stale prices unless explicitly included", () => {
    const q = quote("Martlock", { sellMin: 1500, buyMax: 1000, sellMinAt: minutesAgo(600) });
    const data = marketData([q], [[q, volume()]]);
    expect(scanFlips(data, scanContext([item()], { maxDataAgeMinutes: 120 }))).toHaveLength(0);
    const shown = scanFlips(data, scanContext([item()], { maxDataAgeMinutes: 120 }, { includeStale: true }));
    expect(shown[0].flags).toContain("stale");
  });

  it("skips quotes with a missing side", () => {
    const q = quote("Martlock", { buyMax: null, buyMaxAt: null });
    expect(scanFlips(marketData([q]), scanContext([item()]))).toHaveLength(0);
  });
});

describe("scanTrades", () => {
  const cheap = quote("Martlock", { sellMin: 1000, buyMax: 900 });
  const dear = quote("Lymhurst", { sellMin: 1600, buyMax: 1400 });

  it("evaluates all four scenarios between two cities with exact item/quality match", () => {
    const data = marketData([cheap, dear], [[cheap, volume()], [dear, volume({ avgPrice: 1500 })]]);
    const opps = scanTrades(data, scanContext([item()]));
    const routes = opps.filter((o) => o.buyCity === "Martlock" && o.sellCity === "Lymhurst").map((o) => o.scenario);
    expect(routes.sort()).toEqual(["instant-instant", "instant-order", "order-instant", "order-order"]);
    const ii = opps.find((o) => o.scenario === "instant-instant")!;
    expect(ii.profit.buyPrice).toBe(1000); // Martlock lowest sell order
    expect(ii.profit.sellPrice).toBe(1400); // Lymhurst highest buy order
  });

  it("never matches different qualities or enchant levels", () => {
    const q1 = quote("Martlock", { itemId: "T5_BAG@1", quality: 2, sellMin: 1000, buyMax: 900 });
    const q2 = quote("Lymhurst", { itemId: "T5_BAG", quality: 2, sellMin: 5000, buyMax: 4000 });
    const q3 = quote("Thetford", { itemId: "T5_BAG@1", quality: 3, sellMin: 5000, buyMax: 4000 });
    const items = [item({ id: "T5_BAG@1", enchant: 1, tier: 5 }), item({ id: "T5_BAG", tier: 5 })];
    expect(scanTrades(marketData([q1, q2, q3]), scanContext(items))).toHaveLength(0);
  });

  it("applies city filters", () => {
    const data = marketData([cheap, dear], [[cheap, volume()], [dear, volume({ avgPrice: 1500 })]]);
    const opps = scanTrades(data, scanContext([item()], {}, { buyCity: "Lymhurst" }));
    expect(opps.every((o) => o.buyCity === "Lymhurst")).toBe(true);
  });

  it("marks missing volume as no_volume, low confidence and caps the quantity", () => {
    const data = marketData([cheap, dear]);
    const opps = scanTrades(data, scanContext([item()]));
    expect(opps.length).toBeGreaterThan(0);
    for (const o of opps) {
      expect(o.flags).toContain("no_volume");
      expect(o.confidence).toBe("low");
      expect(o.score).toBeLessThanOrEqual(40);
      expect(o.recommendedQty).toBeLessThanOrEqual(UNKNOWN_VOLUME_MAX_QTY);
    }
  });

  it("flags extreme ROI and outlier prices", () => {
    const troll = quote("Martlock", { sellMin: 100, buyMax: 90 });
    const data = marketData([troll, dear], [[troll, volume({ avgPrice: 1000 })], [dear, volume({ avgPrice: 1500 })]]);
    const opp = scanTrades(data, scanContext([item()])).find((o) => o.scenario === "instant-instant")!;
    expect(opp.flags).toContain("extreme_roi");
    expect(opp.flags).toContain("price_outlier");
    expect(opp.risk).toBe("high");
  });

  it("limits quantity by carry capacity and max investment", () => {
    const data = marketData([cheap, dear], [[cheap, volume({ avgDailyVolume: 10_000 })], [dear, volume({ avgDailyVolume: 10_000, avgPrice: 1500 })]]);
    const byWeight = scanTrades(data, scanContext([item({ weight: 10 })], { carryCapacityKg: 100 }));
    expect(Math.max(...byWeight.map((o) => o.recommendedQty))).toBeLessThanOrEqual(10);
    const byInvestment = scanTrades(data, scanContext([item()], {}, { maxInvestment: 5000 }));
    for (const o of byInvestment) expect(o.requiredCapital).toBeLessThanOrEqual(5000);
  });
});

describe("scanBlackMarket", () => {
  const caerleon = quote("Caerleon", { sellMin: 1000, buyMax: 900 });
  const martlock = quote("Martlock", { sellMin: 1000, buyMax: 900 });
  const bm = quote("Black Market", { sellMin: null, sellMinAt: null, buyMax: 1500 });
  const vols: [typeof bm, ReturnType<typeof volume>][] = [
    [caerleon, volume()],
    [martlock, volume()],
    [bm, volume({ avgPrice: 1500 })],
  ];

  it("Caerleon Instant Buy → Black Market Instant Sell pays only Sales Tax and no transport", () => {
    const opps = scanBlackMarket(marketData([caerleon, bm], vols), scanContext([item()], { transportCostPerKg: 10 }));
    const ii = opps.find((o) => o.scenario === "instant-instant")!;
    expect(ii.kind).toBe("blackmarket");
    expect(ii.buyCity).toBe("Caerleon");
    expect(ii.sellCity).toBe("Black Market");
    expect(ii.profit.buyPrice).toBe(1000);
    expect(ii.profit.sellPrice).toBe(1500);
    expect(ii.profit.transport).toBe(0);
    expect(ii.profit.unitProfit).toBeCloseTo(1500 * (1 - 0.08) - 1000);
    expect(ii.flags).not.toContain("red_zone_transport");
  });

  it("a Buy Order source pays the Setup Fee", () => {
    const opps = scanBlackMarket(marketData([caerleon, bm], vols), scanContext([item()]));
    const oi = opps.find((o) => o.scenario === "order-instant")!;
    expect(oi.profit.buyPrice).toBe(901);
    expect(oi.profit.unitProfit).toBeCloseTo(1500 * (1 - 0.08) - 901 * 1.025);
  });

  it("a Royal City source pays transport and is flagged as a red-zone haul", () => {
    const opps = scanBlackMarket(marketData([martlock, bm], vols), scanContext([item()], { transportCostPerKg: 10 }));
    const ii = opps.find((o) => o.scenario === "instant-instant")!;
    expect(ii.buyCity).toBe("Martlock");
    expect(ii.profit.transport).toBeCloseTo(3.4 * 10);
    expect(ii.flags).toContain("red_zone_transport");
    expect(ii.risk).not.toBe("low");
  });

  it("applies the buy market filter", () => {
    const data = marketData([caerleon, martlock, bm], vols);
    const all = scanBlackMarket(data, scanContext([item()]));
    expect(new Set(all.map((o) => o.buyCity))).toEqual(new Set(["Caerleon", "Martlock"]));
    const onlyCaerleon = scanBlackMarket(data, scanContext([item()], {}, { buyCity: "Caerleon" }));
    expect(onlyCaerleon.length).toBeGreaterThan(0);
    expect(onlyCaerleon.every((o) => o.buyCity === "Caerleon")).toBe(true);
  });

  it("needs a Black Market Buy Order and a Black Market scenario", () => {
    const noOrder = quote("Black Market", { buyMax: null, buyMaxAt: null });
    expect(scanBlackMarket(marketData([caerleon, noOrder]), scanContext([item()]))).toHaveLength(0);
    const data = marketData([caerleon, bm], vols);
    expect(scanBlackMarket(data, scanContext([item()], {}, { scenarios: ["order-order"] }))).toHaveLength(0);
  });

  it("never matches a different Quality", () => {
    const good = quote("Caerleon", { quality: 2, sellMin: 1000, buyMax: 900 });
    expect(scanBlackMarket(marketData([good, bm]), scanContext([item()]))).toHaveLength(0);
  });

  it("keeps Caerleon and the Black Market out of Market Flipping and Cross-City Trade", () => {
    const data = marketData([caerleon, martlock, bm], vols);
    const flips = scanFlips(data, scanContext([item()], {}, { includeUnprofitable: true }));
    expect(flips.map((o) => o.buyCity)).toEqual(["Martlock"]);
    expect(scanTrades(data, scanContext([item()], {}, { includeUnprofitable: true }))).toHaveLength(0);
  });
});
