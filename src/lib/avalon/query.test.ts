import { describe, expect, it } from "vitest";
import { filterZones, matchesZoneQuery, normalizeZoneName, totalChests, DEFAULT_AVALON_FILTERS } from "./query";
import type { AvalonZone } from "./types";

function zone(overrides: Partial<AvalonZone> & { id: string; name: string }): AvalonZone {
  return { type: "TUNNEL_ROYAL", tier: 4, chests: [], dungeons: [], resources: [], ...overrides };
}

const zones: AvalonZone[] = [
  zone({
    id: "TNL-001",
    name: "Ouyos-Aoeuam",
    chests: [{ size: "small", grade: "standard", tier: 4, count: 2 }],
    dungeons: [{ kind: "solo", tier: 4, faction: "HER", count: 1 }],
  }),
  zone({
    id: "TNL-251",
    name: "Fonitos-Amaurom",
    type: "TUNNEL_BLACK_MEDIUM",
    tier: 6,
    chests: [
      { size: "medium", grade: "elite", tier: 6, count: 1 },
      { size: "small", grade: "standard", tier: 6, count: 1 },
    ],
    dungeons: [{ kind: "group", tier: 6, faction: "KPR", count: 1 }],
  }),
  zone({ id: "TNL-300", name: "Ilitos-Ouxum", tier: 8 }),
  zone({ id: "TNL-301", name: "Aoeuam-Fonitos", tier: 6 }),
];

describe("zone name search", () => {
  it("ignores case, spaces and hyphens", () => {
    expect(normalizeZoneName("Ouyos - Aoeuam")).toBe("ouyosaoeuam");
    expect(matchesZoneQuery(zones[0], "ouyos aoeu")).toBe(true);
    expect(matchesZoneQuery(zones[0], "OUYOS-AOEUAM")).toBe(true);
    expect(matchesZoneQuery(zones[0], "tnl001")).toBe(true);
    expect(matchesZoneQuery(zones[0], "fonitos")).toBe(false);
  });

  it("does not use Turkish dotless-i lowercasing", () => {
    expect(matchesZoneQuery(zones[2], "ILITOS")).toBe(true);
  });

  it("ranks names starting with the query first", () => {
    const res = filterZones(zones, { ...DEFAULT_AVALON_FILTERS, query: "fonitos" });
    expect(res.map((z) => z.name)).toEqual(["Fonitos-Amaurom", "Aoeuam-Fonitos"]);
  });
});

describe("filterZones", () => {
  it("returns everything with default filters", () => {
    expect(filterZones(zones, DEFAULT_AVALON_FILTERS)).toHaveLength(4);
  });

  it("filters by tier, type, chest grade and dungeon kind together", () => {
    expect(filterZones(zones, { ...DEFAULT_AVALON_FILTERS, tiers: [6] }).map((z) => z.id)).toEqual(["TNL-251", "TNL-301"]);
    expect(filterZones(zones, { ...DEFAULT_AVALON_FILTERS, types: ["TUNNEL_BLACK_MEDIUM"] }).map((z) => z.id)).toEqual(["TNL-251"]);
    expect(filterZones(zones, { ...DEFAULT_AVALON_FILTERS, chestGrades: ["elite"] }).map((z) => z.id)).toEqual(["TNL-251"]);
    expect(filterZones(zones, { ...DEFAULT_AVALON_FILTERS, dungeonKinds: ["solo"] }).map((z) => z.id)).toEqual(["TNL-001"]);
    expect(filterZones(zones, { ...DEFAULT_AVALON_FILTERS, dungeonKinds: ["solo", "group"] })).toEqual([]);
  });

  it("totals chest counts", () => {
    expect(totalChests(zones[1])).toBe(2);
  });
});
