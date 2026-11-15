import { describe, expect, it } from "vitest";
import { matchesItemQuery } from "./types";

const imbuer = { id: "T4_OFF_ORB_MORGANA", nameEn: "Imbuer's Orb", nameTr: "Aşılayıcı Küresi" };

describe("matchesItemQuery", () => {
  it("matches English names regardless of case (no Turkish dotless-i lowercasing)", () => {
    expect(matchesItemQuery(imbuer, "imbuer")).toBe(true);
    expect(matchesItemQuery(imbuer, "IMBUER")).toBe(true);
  });
  it("matches item ids and Turkish names", () => {
    expect(matchesItemQuery(imbuer, "orb_morgana")).toBe(true);
    expect(matchesItemQuery(imbuer, "aşılayıcı")).toBe(true);
    expect(matchesItemQuery(imbuer, "bag")).toBe(false);
  });
});
