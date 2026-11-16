import { describe, expect, it } from "vitest";
import { eventMessage, l, packet, reliable, responseMessage, s, type Typed } from "@/test/photon-encoder";
import { DamageMeter } from "./meter";
import { PhotonDecoder } from "./photon";
import { readSilverShare } from "./silver";
import { summarizeSession } from "./types";

const silverFlag: Typed = { t: "o", v: true };

/**
 * Live layout (278): 0 picker id, 2 receiver name, 3 silver flag, 5 amount ×10,000. Party capture: one pickup of
 * 282.1988 silver produced one message per party member, all with the picker's id at key 0.
 */
function harness(autoSession = false) {
  const meter = new DamageMeter(null, { autoSession, idleMs: 1000 });
  const decoder = new PhotonDecoder();
  const send = (payload: Uint8Array, at: number) => {
    const messages = decoder.decodePacket(packet([reliable(payload)]), at);
    messages.forEach((msg) => meter.handle(msg));
    return messages[0];
  };
  const join = (id = 41865, name = "pesimist", at = 0) => send(responseMessage(2, { 0: l(id), 2: s(name), 8: s("DNG-UND-01-MAIN-02") }), at);
  const share = (to: string, amount: number, at: number, picker = 118838, extra: Record<number, Typed> = {}) =>
    send(eventMessage(278, { 0: l(picker), 2: s(to), 3: silverFlag, 5: l(Math.round(amount * 10_000)), ...extra }), at);
  return { meter, send, join, share };
}

describe("silver shares", () => {
  it("counts every party member's share, with yours as the session's silver", () => {
    const h = harness();
    h.join();
    h.meter.startSession("party", "Party", 0);
    for (const name of ["Bestianlorry", "woee", "WomanTrader", "pesimist"]) h.share(name, 282.1988, 10);
    h.share("pesimist", 644.23, 20, 41865); // your own pickup
    const snap = h.meter.snapshot()!;
    expect(snap.silver).toMatchObject({ name: "pesimist", pickups: 2 });
    expect(snap.silver!.net).toBeCloseTo(926.4288, 4);
    const byName = Object.fromEntries(snap.players.map((p) => [p.name, p.silver]));
    expect(byName.woee).toBeCloseTo(282.1988, 4);
    expect(snap.runs!.at(-1)!.silver).toBeCloseTo(926.4288, 4);
  });

  it("credits shares received before the join reply named you", () => {
    const h = harness();
    h.meter.startSession("mid-zone", "Mid-zone", 0);
    h.send(eventMessage(82, { 0: l(118851), 1: l(10_000_000), 2: l(1_000_000) }), 5); // you, still unnamed
    h.share("pesimist", 281.5, 10, 118851);
    h.share("uk23t", 281.5, 10, 118851); // a party member's cut of your pickup
    expect(h.meter.snapshot()!.silver).toBeNull();
    h.join(41865, "pesimist", 20);
    expect(h.meter.snapshot()!.silver).toMatchObject({ name: "pesimist", net: 281.5, pickups: 1 });
  });

  it("does not count a replayed message twice, but does count two equal pickups", () => {
    const h = harness();
    h.join();
    h.meter.startSession("dupes", "Dupes", 0);
    const first = h.share("pesimist", 55.8418, 10, 227);
    h.share("pesimist", 55.8418, 10, 227); // live solo capture: two pickups in one packet
    h.meter.handle(first); // calibration replay
    expect(h.meter.snapshot()!.silver!.pickups).toBe(2);
  });

  it("ignores loot that is not silver and malformed amounts", () => {
    const h = harness();
    h.join();
    h.meter.startSession("bad", "Bad", 0);
    h.share("pesimist", 100, 10, 1, { 3: { t: "o", v: false } });
    h.share("pesimist", 100, 11, 1, { 5: { t: "f", v: 1.5 } });
    const item = h.send(eventMessage(278, { 0: l(1), 1: s("@MOB_UNDEAD"), 2: s("pesimist"), 4: l(3000), 5: l(1) }), 12);
    expect(readSilverShare(item)).toBeNull();
    expect(h.meter.snapshot()!.silver).toBeNull();
  });

  it("starts and saves an auto session on silver alone, and shows it in the summary", () => {
    const h = harness(true);
    h.join();
    h.share("pesimist", 55.8418, 10, 227);
    h.share("pesimist", 55.8418, 500, 227);
    expect(h.meter.tick(1100).saved).toBeNull();
    const { saved } = h.meter.tick(1501);
    expect(saved).toMatchObject({ startedAt: 10, endedAt: 500, silver: { pickups: 2 } });
    expect(summarizeSession(saved!).silver!.net).toBeCloseTo(111.6836, 4);
  });
});
