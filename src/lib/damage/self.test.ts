import { describe, expect, it } from "vitest";
import { eventMessage, f, i, k, l, packet, reliable, responseMessage, s } from "@/test/photon-encoder";
import { DamageMeter, SELF_PLACEHOLDER } from "./meter";
import { PhotonDecoder } from "./photon";
import type { DamageConfig } from "./types";

/** Same layout as live traffic: join reply (response 2), identity event 29, hits in event 6, Fame in event 82. */
const config: DamageConfig = {
  version: 1,
  identity: [
    { signature: "response:2", nameKey: 2, idKey: 0 },
    { signature: "event:278", nameKey: 2, idKey: 0 },
  ],
  health: { signature: "event:6", causerKey: 6, changeKey: 2, targetKey: 0 },
  calibratedAt: "2026-11-15T00:00:00.000Z",
  source: "auto",
};

const BATTLEAXE_INDEX = 8413; // T5_MAIN_AXE@1 in the item catalog

function harness() {
  const meter = new DamageMeter(config, { autoSession: true, idleMs: 60_000 });
  const decoder = new PhotonDecoder();
  const send = (payload: Uint8Array, at: number) => decoder.decodePacket(packet([reliable(payload)]), at).forEach((m) => meter.handle(m));
  const join = (id: number, name: string, mainHandObject: number, at: number) =>
    send(responseMessage(2, { 0: l(id), 2: s(name), 52: { t: "y", el: "i", v: [mainHandObject, 9002, 9003, 9004, 9005, 9006, 9007, 9008, 0, 0] } }), at);
  const newItem = (objectId: number, index: number, at: number) => send(eventMessage(30, { 0: l(objectId), 1: k(index), 2: k(1) }), at);
  const hit = (causer: number, dmg: number, at: number) => send(eventMessage(6, { 0: l(70_000), 1: i(1), 2: f(-dmg), 6: l(causer) }), at);
  const fame = (id: number, counter: number, gain: number, at: number) =>
    send(eventMessage(82, { 0: l(id), 1: l(counter * 10_000), 2: l(gain * 10_000) }), at);
  return { meter, send, join, newItem, hit, fame };
}

describe("own character", () => {
  it("resolves your Main Hand from the join reply's equipment list and NewEquipmentItem", () => {
    const h = harness();
    h.join(33839, "pesimist", 33841, 0);
    h.newItem(33841, BATTLEAXE_INDEX, 1);
    h.hit(33839, 120, 2);
    const me = h.meter.snapshot()!.players.find((p) => p.name === "pesimist")!;
    expect(me.mainHand?.item?.id).toBe("T5_MAIN_AXE@1");
    expect(me.damage).toBe(120);
  });

  it("an empty Main Hand slot in the join reply means no weapon", () => {
    const h = harness();
    h.join(33839, "pesimist", 0, 0);
    h.hit(33839, 50, 1);
    expect(h.meter.snapshot()!.players[0].mainHand).toEqual({ item: null, observedAt: 0 });
  });

  it("identifies you from your first Fame reward when the capture starts mid-zone, and only the join reply names you", () => {
    const h = harness();
    h.fame(38751, 1000, 200, 10); // no join reply yet
    expect(h.meter.selfName).toBe(SELF_PLACEHOLDER);
    h.hit(38751, 90, 20);
    expect(h.meter.snapshot()!.fame).toMatchObject({ name: SELF_PLACEHOLDER, total: 200 });
    // Live party capture: silver from your kill is split, and the loot message pairs your id with a party member.
    h.send(eventMessage(278, { 0: l(38751), 2: s("uk23t"), 3: { t: "o", v: true } }), 30);
    h.fame(38751, 1200, 200, 35);
    expect(h.meter.selfName).toBe(SELF_PLACEHOLDER);
    h.join(41865, "pesimist", 0, 40); // zone change: new id, real name
    h.fame(41865, 1400, 200, 45);
    h.hit(41865, 60, 50);
    const snap = h.meter.snapshot()!;
    expect(h.meter.selfName).toBe("pesimist");
    expect(snap.players.map((p) => [p.name, p.damage])).toEqual([["pesimist", 150]]);
    expect(snap.fame).toMatchObject({ name: "pesimist", total: 600, events: 3 });
  });

  it("a later join reply in a new zone renames the placeholder and keeps counting Fame", () => {
    const h = harness();
    h.fame(38751, 1000, 200, 10);
    h.hit(38751, 90, 20);
    h.join(41000, "pesimist", 0, 30); // new zone: new object id
    h.fame(41000, 1300, 300, 40);
    h.hit(41000, 10, 50);
    const snap = h.meter.snapshot()!;
    expect(snap.players.map((p) => [p.name, p.damage])).toEqual([["pesimist", 100]]);
    expect(snap.fame).toMatchObject({ name: "pesimist", total: 500, events: 2 });
  });
});
