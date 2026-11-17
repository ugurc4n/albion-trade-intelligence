import { describe, expect, it } from "vitest";
import { playerRanking, sessionSeconds } from "./presentation";
import type { SessionRecord } from "./types";

const session: SessionRecord = {
  id: "test", label: "Test", startedAt: 1_000, endedAt: null,
  unattributedDamage: 500, configCalibratedAt: null,
  players: [
    { name: "Alice", damage: 300, heal: 0, taken: 25, hits: 3, firstAt: 1_000, lastAt: 3_000 },
    { name: "Bob", damage: 100, heal: 200, taken: 75, hits: 1, firstAt: 2_000, lastAt: 3_000 },
  ],
};

describe("Damage Meter presentation", () => {
  it("uses the visible total for both share values and bar widths, excluding unmatched Damage", () => {
    const ranking = playerRanking(session, "damage", null);
    expect(ranking.total).toBe(400);
    expect(ranking.share(ranking.players[0])).toBe(0.75);
    expect(ranking.share(ranking.players[1])).toBe(0.25);
  });

  it("ranks and normalizes each selected metric without changing recorded player order", () => {
    for (const metric of ["heal", "taken"] as const) {
      const ranking = playerRanking(session, metric, null);
      expect(ranking.players.map((p) => p.name)).toEqual(["Bob", "Alice"]);
      expect(ranking.share(ranking.players[0])).toBe(metric === "heal" ? 1 : 0.75);
    }
    expect(session.players.map((p) => p.name)).toEqual(["Alice", "Bob"]);
  });

  it("matches names case-insensitively and recalculates totals for the exact selection", () => {
    const ranking = playerRanking(session, "damage", ["bOB"]);
    expect(ranking.players.map((p) => p.name)).toEqual(["Bob"]);
    expect(ranking.total).toBe(100);
    expect(ranking.share(ranking.players[0])).toBe(1);
    expect(playerRanking(session, "damage", ["Missing"]).players).toEqual([]);
  });

  it("returns zero shares when a metric has no recorded values", () => {
    const ranking = playerRanking(session, "heal", ["Alice"]);
    expect(ranking.total).toBe(0);
    expect(ranking.share(ranking.players[0])).toBe(0);
  });

  it("uses elapsed session time for live DPS and freezes duration for saved sessions", () => {
    expect(sessionSeconds(session, 11_000)).toBe(10);
    expect(sessionSeconds({ ...session, endedAt: 6_000 }, 100_000)).toBe(5);
    expect(sessionSeconds(session, 1_000)).toBe(1);
  });
});
