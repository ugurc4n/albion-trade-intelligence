import { describe, expect, it } from "vitest";
import { eventMessage, f, l, packet, reliable, responseMessage, s, type Typed } from "@/test/photon-encoder";
import { DamageMeter } from "./meter";
import { PhotonDecoder } from "./photon";
import { readFameReward } from "./fame";
import { summarizeSession } from "./types";

function harness(autoSession = false) {
  const meter = new DamageMeter(null, { autoSession, idleMs: 1000 });
  const decoder = new PhotonDecoder();
  const send = (payload: Uint8Array, at: number) => {
    const messages = decoder.decodePacket(packet([reliable(payload)]), at);
    messages.forEach((msg) => meter.handle(msg));
    return messages[0];
  };
  const join = (id = 101, name = "Alice", at = 0) => send(responseMessage(2, { 0: l(id), 2: s(name) }), at);
  const reward = (counter: number, gain: number, at: number, extra: Record<number, Typed> = {}, id = 101) => send(eventMessage(82, {
    0: l(id), 1: l(counter * 10_000), 2: l(gain * 10_000), ...extra,
  }), at);
  return { meter, send, join, reward };
}

describe("personal Fame from decoded packets", () => {
  it("counts actual fixed-point rewards without Premium and without requiring damage calibration", () => {
    const h = harness();
    h.join();
    h.meter.startSession("one", "One hour", 0);
    h.reward(46936981.2266, 202.1, 10);
    h.reward(46938223.9266, 1242.7, 20);
    const fame = h.meter.snapshot()!.fame!;
    expect(fame).toMatchObject({ name: "Alice", premium: 0, satchel: 0, events: 2, lastBonusPercent: null });
    expect(fame.total).toBeCloseTo(1444.8, 4);
    expect(fame.zoneIncluded).toBeCloseTo(1444.8, 4);
  });

  it("separates Premium and Satchel contributions without applying the reported modifier twice", () => {
    const h = harness();
    h.join();
    h.meter.startSession("bonuses", "Bonuses", 0);
    h.reward(1000, 200, 10, { 5: { t: "o", v: true }, 10: l(400_000), 17: f(0.1) });
    expect(h.meter.snapshot()!.fame).toMatchObject({ total: 340, zoneIncluded: 200, premium: 100, satchel: 40, events: 1 });
    expect(h.meter.snapshot()!.fame!.lastBonusPercent).toBeCloseTo(10, 4);
    h.reward(1200, 200, 20);
    expect(h.meter.snapshot()!.fame).toMatchObject({ total: 540, premium: 100, satchel: 40, lastBonusPercent: null });
  });

  it("credits Fame before the join reply to you (UpdateFame is local-player only) but never another character's", () => {
    const h = harness();
    h.meter.startSession("self", "Self", 0);
    // Capture started mid-zone: the first reward identifies you under a placeholder name.
    h.reward(100, 100, 1);
    expect(h.meter.snapshot()!.fame).toMatchObject({ name: "Sen", total: 100 });
    h.join();
    expect(h.meter.snapshot()!.fame).toMatchObject({ name: "Alice", total: 100 });
    h.reward(200, 100, 2, {}, 202); // another object id: not you
    expect(h.meter.snapshot()!.fame!.total).toBe(100);
    h.reward(300, 50, 3);
    expect(h.meter.snapshot()!.fame!.total).toBe(150);
  });

  it("deduplicates retransmissions and calibration replay, including across sessions and zone changes", () => {
    const h = harness();
    h.join();
    h.meter.startSession("first", "First", 0);
    const old = h.reward(1000, 100, 10);
    h.meter.handle(old);
    h.reward(900, 100, 9);
    expect(h.meter.snapshot()!.fame!.total).toBe(100);
    const saved = h.meter.stopSession(15)!;
    h.meter.startSession("second", "Second", 16);
    h.meter.handle(old);
    h.join(201, "Alice", 17);
    h.reward(1100, 100, 20, {}, 201);
    h.reward(1200, 100, 21, {}, 101);
    expect(h.meter.snapshot()!.fame).toMatchObject({ total: 100, events: 1 });
    expect(JSON.parse(JSON.stringify(saved)).fame.total).toBe(100);
  });

  it("keeps saved snapshots independent and excludes rewards outside the session", () => {
    const h = harness();
    h.join();
    h.reward(1000, 100, 1);
    h.meter.startSession("in", "In", 2);
    h.reward(1100, 100, 3);
    const snapshot = h.meter.snapshot()!;
    h.reward(1200, 100, 4);
    expect(snapshot.fame!.total).toBe(100);
    const saved = h.meter.stopSession(5)!;
    h.reward(1300, 100, 6);
    expect(saved.fame!.total).toBe(200);
    expect(h.meter.snapshot()).toBeNull();
  });

  it("starts and saves a Fame-only auto session, extending activity when Fame arrives", () => {
    const h = harness(true);
    h.join();
    h.reward(1000, 100, 10);
    h.reward(1100, 100, 500);
    expect(h.meter.snapshot()).toMatchObject({ auto: true, startedAt: 10, players: [], fame: { total: 200 } });
    expect(h.meter.tick(1100).saved).toBeNull();
    const result = h.meter.tick(1501);
    expect(result.discarded).toBe(false);
    expect(result.saved).toMatchObject({ endedAt: 500, fame: { total: 200 } });
    expect(summarizeSession(result.saved!)).toMatchObject({ playerCount: 1, fame: { name: "Alice", total: 200 } });
  });

  it("rejects invalid fixed-point values, crafting arrays, wrong event types and missing counters", () => {
    const h = harness();
    h.join();
    h.meter.startSession("bad", "Bad", 0);
    for (const extra of [
      { 2: f(20) }, { 2: l(-1) }, { 1: f(1000) }, { 10: { t: "y", el: "l", v: [10] } },
      { 5: l(1) }, { 2: l(0) }, { 2: f(Infinity) },
    ] as Record<number, Typed>[]) h.reward(1000, 100, 1, extra);
    h.send(eventMessage(82, { 0: l(101), 2: l(100_000) }), 1);
    const notFame = h.send(eventMessage(83, { 0: l(101), 1: l(100_000), 2: l(10_000) }), 1);
    expect(readFameReward(notFame)).toBeNull();
    expect(h.meter.snapshot()!.fame).toBeNull();
  });

  it("does not mix different characters into one personal Fame record", () => {
    const h = harness();
    h.join();
    h.meter.startSession("alice", "Alice", 0);
    h.reward(1000, 100, 1);
    h.join(202, "Bob", 2);
    h.reward(1000, 200, 3, {}, 202);
    expect(h.meter.snapshot()!.fame).toMatchObject({ name: "Alice", total: 100 });
  });
});
