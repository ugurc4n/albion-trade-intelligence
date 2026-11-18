import { describe, expect, it } from "vitest";
import type { PriceRow } from "@/lib/albion/schemas";
import { computeVolumeStats } from "./history";
import { normalizeMarketRow, normalizePriceRow, parseApiDate } from "./normalize";

const EMPTY = "0001-01-01T00:00:00";

function row(overrides: Partial<PriceRow> = {}): PriceRow {
  return {
    item_id: "T4_BAG",
    city: "Martlock",
    quality: 1,
    sell_price_min: 3896,
    sell_price_min_date: "2026-11-14T18:15:00",
    sell_price_max: 3900,
    sell_price_max_date: "2026-11-14T18:15:00",
    buy_price_min: 13,
    buy_price_min_date: "2026-11-14T18:15:00",
    buy_price_max: 2823,
    buy_price_max_date: "2026-11-14T18:10:00",
    ...overrides,
  };
}

describe("parseApiDate", () => {
  it("treats timestamps without zone as UTC", () => {
    expect(parseApiDate("2026-11-14T18:15:00")).toBe(Date.UTC(2026, 10, 14, 18, 15, 0));
  });
  it("returns null for the 0001-01-01 sentinel and garbage", () => {
    expect(parseApiDate(EMPTY)).toBeNull();
    expect(parseApiDate("")).toBeNull();
    expect(parseApiDate("not a date")).toBeNull();
  });
});

describe("normalizePriceRow", () => {
  it("uses only the lowest sell order and the highest buy order", () => {
    const q = normalizePriceRow(row())!;
    expect(q.sellMin).toBe(3896);
    expect(q.buyMax).toBe(2823); // never the troll buy_price_min of 13
    expect(q.buyMaxAt).toBe(Date.UTC(2026, 10, 14, 18, 10, 0));
  });

  it("returns null when no side has data (0 prices + sentinel dates)", () => {
    expect(
      normalizePriceRow(
        row({ sell_price_min: 0, sell_price_min_date: EMPTY, buy_price_max: 0, buy_price_max_date: EMPTY }),
      ),
    ).toBeNull();
  });

  it("keeps one side when the other is missing", () => {
    const q = normalizePriceRow(row({ buy_price_max: 0, buy_price_max_date: EMPTY }))!;
    expect(q.sellMin).toBe(3896);
    expect(q.buyMax).toBeNull();
    expect(q.buyMaxAt).toBeNull();
  });

  it("drops a price whose date is the sentinel even if the price is non-zero", () => {
    const q = normalizePriceRow(row({ sell_price_min_date: EMPTY }))!;
    expect(q.sellMin).toBeNull();
  });

  it("maps multi-word cities and rejects non-royal locations", () => {
    expect(normalizePriceRow(row({ city: "Fort Sterling" }))?.city).toBe("Fort Sterling");
    expect(normalizePriceRow(row({ city: "Caerleon" }))).toBeNull();
    expect(normalizePriceRow(row({ city: "Black Market" }))).toBeNull();
    expect(normalizePriceRow(row({ city: "Brecilien" }))).toBeNull();
  });

  it("keeps enchant and quality identity intact", () => {
    const q = normalizePriceRow(row({ item_id: "T5_BAG@1", quality: 3 }))!;
    expect(q.itemId).toBe("T5_BAG@1");
    expect(q.quality).toBe(3);
  });
});

describe("computeVolumeStats", () => {
  const now = Date.UTC(2026, 10, 14, 20, 0, 0);
  const day = (d: number) => new Date(Date.UTC(2026, 10, 14 - d)).toISOString().slice(0, 19);

  it("returns unknown (null) volume when there is no history", () => {
    const s = computeVolumeStats([], now);
    expect(s.avgDailyVolume).toBeNull();
    expect(s.daysWithData).toBe(0);
  });

  it("averages over the full window, counting missing days as zero", () => {
    const s = computeVolumeStats(
      [
        { item_count: 70, avg_price: 100, timestamp: day(1) },
        { item_count: 70, avg_price: 110, timestamp: day(2) },
      ],
      now,
    );
    expect(s.avgDailyVolume).toBeCloseTo(20); // 140 / 7
    expect(s.avgPrice).toBeCloseTo(105);
    expect(s.daysWithData).toBe(2);
    expect(s.volatility).toBeNull(); // fewer than 3 points
  });

  it("ignores points outside the window and computes volatility", () => {
    const s = computeVolumeStats(
      [
        { item_count: 10, avg_price: 100, timestamp: day(1) },
        { item_count: 10, avg_price: 120, timestamp: day(2) },
        { item_count: 10, avg_price: 80, timestamp: day(3) },
        { item_count: 9999, avg_price: 1, timestamp: day(20) },
      ],
      now,
    );
    expect(s.avgDailyVolume).toBeCloseTo(30 / 7);
    expect(s.volatility).toBeGreaterThan(0.1);
  });
});

describe("normalizeMarketRow", () => {
  it("keeps Caerleon and Black Market rows but still rejects other locations", () => {
    expect(normalizeMarketRow(row({ city: "Caerleon" }))?.city).toBe("Caerleon");
    expect(normalizeMarketRow(row({ city: "Black Market" }))?.city).toBe("Black Market");
    expect(normalizeMarketRow(row({ city: "Fort Sterling" }))?.city).toBe("Fort Sterling");
    expect(normalizeMarketRow(row({ city: "Brecilien" }))).toBeNull();
  });
});
