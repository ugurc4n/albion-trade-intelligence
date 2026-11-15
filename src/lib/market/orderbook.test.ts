import { describe, expect, it } from "vitest";
import { depthNearPrice, isLevelSuperseded } from "./orderbook";

const at = (iso: string) => Date.parse(`${iso}Z`);

describe("depthNearPrice", () => {
  const sells = [
    { price: 3997, amount: 1, updated_at: "2026-11-14T10:00:00" }, // seen 8 h before the latest quote
    { price: 4988, amount: 11, updated_at: "2026-11-14T18:00:00" },
    { price: 4990, amount: 63, updated_at: "2026-11-14T18:00:00" },
    { price: 6000, amount: 500, updated_at: "2026-11-14T18:00:00" },
  ];

  it("sums sell levels within the tolerance above the reference price", () => {
    expect(depthNearPrice(sells, 4988, "sell")).toBe(1 + 11 + 63);
  });

  it("ignores levels superseded by a newer price observation", () => {
    const latestQuote = at("2026-11-14T18:02:00");
    expect(depthNearPrice(sells, 4988, "sell", latestQuote)).toBe(11 + 63);
    expect(isLevelSuperseded(sells[0], latestQuote)).toBe(true);
    expect(isLevelSuperseded(sells[1], latestQuote)).toBe(false);
  });

  it("sums buy levels within the tolerance below the reference price", () => {
    const buys = [
      { price: 3153, amount: 61, updated_at: "2026-11-14T18:00:00" },
      { price: 3100, amount: 10, updated_at: "2026-11-14T18:00:00" },
      { price: 2000, amount: 999, updated_at: "2026-11-14T18:00:00" },
    ];
    expect(depthNearPrice(buys, 3153, "buy")).toBe(71);
  });
});
