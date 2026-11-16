import { describe, expect, it } from "vitest";
import { eventMessage, f, i, l, packet, reliable, responseMessage, s } from "@/test/photon-encoder";
import { DamageMeter } from "./meter";
import { PhotonDecoder } from "./photon";
import { summarizeSession, type DamageConfig } from "./types";
import { zoneLabel } from "./zone";

const config: DamageConfig = {
  version: 1,
  identity: [{ signature: "response:2", nameKey: 2, idKey: 0 }],
  health: { signature: "event:6", causerKey: 6, changeKey: 2, targetKey: 0 },
  calibratedAt: "2026-11-16T00:00:00.000Z",
  source: "auto",
};

/** Same layout as the live capture: join reply carries the zone (8) and balance (33), UpdateMoney is event 81. */
function harness() {
  const meter = new DamageMeter(config, { autoSession: true, idleMs: 60_000 });
  const decoder = new PhotonDecoder();
  const send = (payload: Uint8Array, at: number) => {
    const messages = decoder.decodePacket(packet([reliable(payload)]), at);
    messages.forEach((m) => meter.handle(m));
    return messages[0];
  };
  const join = (id: number, zone: string, balance: number, at: number) =>
    send(responseMessage(2, { 0: l(id), 2: s("pesimist"), 8: s(zone), 33: l(balance * 10_000) }), at);
  const hit = (id: number, dmg: number, at: number) => send(eventMessage(6, { 0: l(9000), 1: i(1), 2: f(-dmg), 6: l(id) }), at);
  const fame = (id: number, counter: number, gain: number, at: number) =>
    send(eventMessage(82, { 0: l(id), 1: l(counter * 10_000), 2: l(gain * 10_000) }), at);
  let tick = 1;
  const silver = (id: number, amount: number, at: number) =>
    send(eventMessage(62, { 0: l(id), 1: i(tick++), 2: l(500 + tick), 3: l(amount * 10_000) }), at);
  const money = (id: number, balance: number, at: number) => send(eventMessage(81, { 0: l(id), 1: l(balance * 10_000) }), at);
  return { meter, send, join, hit, fame, silver, money };
}

describe("runs", () => {
  it("splits a session into one run per zone, with that zone's Fame, silver and damage", () => {
    const h = harness();
    h.join(227, "3207", 11_345_942, 0);
    h.join(300, "@RANDOMDUNGEON@01142fe7", 11_345_942, 10);
    h.hit(300, 100, 20);
    h.fame(300, 1000, 50, 21);
    h.silver(300, 55, 22);
    h.join(400, "3207", 11_345_997, 100);
    h.hit(400, 30, 110);
    const runs = h.meter.snapshot()!.runs!;
    expect(runs.map((r) => [r.zone, r.startedAt, r.endedAt, r.damage, r.fame, r.silver])).toEqual([
      ["@RANDOMDUNGEON@01142fe7", 20, 100, 100, 50, 55],
      ["3207", 100, null, 30, 0, 0],
    ]);
    expect(zoneLabel(runs[0].zone)).toBe("Random Dungeon");
    expect(zoneLabel(runs[1].zone)).toBe("Bölge 3207");
  });

  it("drops zones entered after an auto session's last activity", () => {
    const h = harness();
    h.join(300, "@RANDOMDUNGEON@a", 0, 0);
    for (let n = 0; n < 12; n++) h.hit(300, 10, 10 + n);
    h.join(400, "3207", 0, 50);
    const { saved } = h.meter.tick(60_000 + 50);
    expect(saved!.runs!.map((r) => [r.zone, r.endedAt])).toEqual([["@RANDOMDUNGEON@a", 21]]);
    expect(summarizeSession(saved!).runCount).toBe(1);
  });

  it("ignores replayed join replies", () => {
    const h = harness();
    const old = h.join(300, "@RANDOMDUNGEON@a", 0, 0);
    h.hit(300, 10, 5);
    h.meter.handle(old);
    expect(h.meter.snapshot()!.runs).toHaveLength(1);
  });
});

describe("balance", () => {
  it("tracks your balance from the session start through every update and zone change", () => {
    const h = harness();
    h.join(227, "3207", 11_345_942.6666, 0);
    h.meter.startSession("s", "S", 1);
    h.money(227, 11_345_998.5084, 2);
    h.money(999, 1, 3); // someone else's id
    h.join(400, "3207", 11_346_768.6602, 4);
    h.money(400, 11_346_700, 5); // e.g. a repair
    const b = h.meter.snapshot()!.balance!;
    expect(b.start).toBeCloseTo(11_345_942.6666, 4);
    expect(b.end).toBeCloseTo(11_346_700, 4);
    expect(summarizeSession(h.meter.stopSession(6)!).balanceChange).toBeCloseTo(757.3334, 4);
  });

  it("starts from the first update when the balance was unknown, and never moves back on replay", () => {
    const h = harness();
    h.send(responseMessage(2, { 0: l(227), 2: s("pesimist"), 8: s("3207") }), 0); // join reply without a balance
    h.meter.startSession("s", "S", 1);
    expect(h.meter.snapshot()!.balance).toBeNull();
    const first = h.money(227, 100, 2);
    h.money(227, 150, 3);
    h.meter.handle(first);
    expect(h.meter.snapshot()!.balance).toEqual({ start: 100, end: 150 });
  });
});
