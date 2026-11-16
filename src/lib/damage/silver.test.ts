import { describe, expect, it } from "vitest";
import { eventMessage, i, l, packet, reliable, responseMessage, s, type Typed } from "@/test/photon-encoder";
import { DamageMeter } from "./meter";
import { PhotonDecoder } from "./photon";
import { readSilverPickup } from "./silver";
import { summarizeSession } from "./types";

/** Values from a live solo-dungeon capture: 58.7808 before tax, 2.9390 guild tax → 55.8418 received. */
function harness(autoSession = false) {
  const meter = new DamageMeter(null, { autoSession, idleMs: 1000 });
  const decoder = new PhotonDecoder();
  const send = (payload: Uint8Array, at: number) => {
    const messages = decoder.decodePacket(packet([reliable(payload)]), at);
    messages.forEach((msg) => meter.handle(msg));
    return messages[0];
  };
  const join = (id = 227, name = "pesimist") => send(responseMessage(2, { 0: l(id), 2: s(name) }), 0);
  let tick = 82_705_253;
  const pickup = (at: number, extra: Record<number, Typed> = {}, id = 227) =>
    send(eventMessage(62, { 0: l(id), 1: i(tick++), 2: l(245 + at), 3: l(587_808), 5: l(29_390), 8: l(24_492), ...extra }), at);
  return { meter, send, join, pickup };
}

describe("silver pickups", () => {
  it("counts silver after tax for your own character", () => {
    const h = harness();
    h.join();
    h.meter.startSession("run", "Run", 0);
    h.pickup(10);
    h.pickup(20);
    const silver = h.meter.snapshot()!.silver!;
    expect(silver).toMatchObject({ name: "pesimist", pickups: 2 });
    expect(silver.net).toBeCloseTo(111.6836, 4);
    expect(silver.preTax).toBeCloseTo(117.5616, 4);
    expect(silver.tax).toBeCloseTo(5.878, 4);
  });

  it("deducts cluster tax and alliance penalty too", () => {
    const h = harness();
    h.join();
    h.meter.startSession("taxes", "Taxes", 0);
    h.pickup(10, { 4: l(10_000), 6: l(5_000) });
    expect(h.meter.snapshot()!.silver!.net).toBeCloseTo(58.7808 - 2.939 - 1 - 0.5, 4);
  });

  it("ignores other characters, duplicates, replay and pickups before you are known", () => {
    const h = harness();
    h.meter.startSession("dupes", "Dupes", 0);
    h.pickup(5); // your id is not known yet
    h.join();
    const first = h.pickup(10);
    h.meter.handle(first); // retransmission / calibration replay
    h.pickup(20, {}, 999); // someone else's pickup
    expect(h.meter.snapshot()!.silver).toMatchObject({ pickups: 1 });
  });

  it("rejects malformed amounts and other events", () => {
    const h = harness();
    h.join();
    h.meter.startSession("bad", "Bad", 0);
    h.pickup(10, { 3: l(0) });
    h.pickup(11, { 5: { t: "f", v: 1.5 } });
    const notSilver = h.send(eventMessage(63, { 0: l(227), 3: l(587_808) }), 12);
    expect(readSilverPickup(notSilver)).toBeNull();
    expect(h.meter.snapshot()!.silver).toBeNull();
  });

  it("starts and keeps an auto session on silver alone, and shows it in the summary", () => {
    const h = harness(true);
    h.join();
    h.pickup(10);
    h.pickup(500);
    expect(h.meter.tick(1100).saved).toBeNull();
    const { saved } = h.meter.tick(1501);
    expect(saved).toMatchObject({ startedAt: 10, endedAt: 500, silver: { pickups: 2 } });
    expect(summarizeSession(saved!).silver!.net).toBeCloseTo(111.6836, 4);
  });
});
