import { describe, expect, it } from "vitest";
import { eventMessage, f, i, l, packet, reliable, responseMessage, s, type Typed } from "@/test/photon-encoder";
import { DamageMeter } from "./meter";
import { readPartyUpdate } from "./party";
import { PhotonDecoder } from "./photon";

/** Live party capture: join reply GUID at 1, NewCharacter GUID at 7, PartyOnClusterPartyJoined (242) GUIDs at 0. */
const guid = (n: number) => new Uint8Array(16).fill(n);
const bytes = (v: Uint8Array): Typed => ({ t: "x", v });
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.length * 16);
  parts.forEach((p, n) => out.set(p, n * 16));
  return out;
};

function harness() {
  const meter = new DamageMeter(null, { autoSession: true, idleMs: 60_000 });
  const decoder = new PhotonDecoder();
  const send = (payload: Uint8Array, at = 1) => decoder.decodePacket(packet([reliable(payload)]), at).forEach((m) => meter.handle(m));
  const join = () => send(responseMessage(2, { 0: l(41865), 1: bytes(guid(1)), 2: s("pesimist"), 8: s("DNG-UND-01-MAIN-02") }));
  const character = (id: number, name: string, g: number) => send(eventMessage(29, { 0: l(id), 1: s(name), 7: bytes(guid(g)) }));
  const hit = (causer: number, dmg: number) => send(eventMessage(6, { 0: l(9000), 1: i(1), 2: f(-dmg), 3: f(500), 6: l(causer) }));
  return { meter, send, join, character, hit };
}

describe("party roster", () => {
  it("knows the party from the zone-entry roster, by user GUID, and keeps strangers out of it", () => {
    const h = harness();
    h.send(eventMessage(242, { 0: bytes(concat(guid(2), guid(3), guid(1))) }));
    h.join();
    h.character(41813, "Bestianlorry", 2);
    h.character(41854, "uk23t", 3);
    h.character(119281, "oskariada", 9); // another player in the dungeon
    for (const [id, dmg] of [[41865, 100], [41854, 200], [41813, 50], [119281, 70]]) h.hit(id, dmg);
    const snap = h.meter.snapshot()!;
    expect(snap.party?.sort()).toEqual(["Bestianlorry", "pesimist", "uk23t"]);
    expect(snap.players.map((p) => p.name).sort()).toEqual(["Bestianlorry", "oskariada", "pesimist", "uk23t"]);
  });

  it("is unknown until the game sends a roster, and follows joins, leaves and disbanding", () => {
    const h = harness();
    h.join();
    h.character(41813, "Bestianlorry", 2);
    h.hit(41865, 10);
    expect(h.meter.snapshot()!.party).toBeNull();
    h.send(eventMessage(232, { 1: bytes(guid(2)), 2: s("Bestianlorry") }));
    expect(h.meter.snapshot()!.party?.sort()).toEqual(["Bestianlorry", "pesimist"]);
    h.send(eventMessage(234, { 1: bytes(guid(2)) }));
    expect(h.meter.snapshot()!.party).toEqual(["pesimist"]);
    h.send(eventMessage(231, {}));
    expect(h.meter.snapshot()!.party).toEqual(["pesimist"]);
  });

  it("adds a member who enters the zone after you, from a silver split you share", () => {
    // Live run: the roster on your zone entry had five names; DAYI917 came in later, hit the 2nd most and got
    // the same silver shares as everyone else, but was missing from the party.
    const h = harness();
    h.send(eventMessage(242, { 0: bytes(concat(guid(2), guid(1))) }));
    h.join();
    h.character(41813, "Bestianlorry", 2);
    h.character(50000, "DAYI917", 7); // entered later; no roster update for it
    h.character(60000, "Stranger", 8);
    for (const [id, dmg] of [[41865, 100], [41813, 50], [50000, 90], [60000, 30]]) h.hit(id, dmg);
    expect(h.meter.snapshot()!.party?.sort()).toEqual(["Bestianlorry", "pesimist"]);
    const silver = (picker: number, to: string, amount: number, at: number) =>
      h.send(eventMessage(278, { 0: l(picker), 2: s(to), 3: { t: "o", v: true }, 5: l(amount * 10_000) }), at);
    // Another party's pickup next to you: shares that do not include you prove nothing.
    for (const to of ["Stranger", "Other"]) silver(60000, to, 300, 10);
    // One pickup split between your party members (same picker, amount and moment).
    for (const to of ["Bestianlorry", "pesimist", "DAYI917"]) silver(41813, to, 282, 20);
    expect(h.meter.snapshot()!.party?.sort()).toEqual(["Bestianlorry", "DAYI917", "pesimist"]);
  });

  it("keeps two equal pickups in a row apart, and a solo share adds nobody", () => {
    const h = harness();
    h.join();
    const silver = (to: string, at: number) =>
      h.send(eventMessage(278, { 0: l(41865), 2: s(to), 3: { t: "o", v: true }, 5: l(100 * 10_000) }), at);
    silver("pesimist", 10);
    silver("pesimist", 10); // a second identical pickup: a new split, not a party of one name twice
    expect(h.meter.snapshot()!.party).toBeNull();
  });

  it("resolves roster GUIDs from player info (104) before the member comes into view", () => {
    const h = harness();
    h.send(eventMessage(242, { 0: bytes(concat(guid(2), guid(1))) }));
    h.join();
    h.send(eventMessage(104, { 0: bytes(guid(2)), 1: s("woee"), 2: { t: "o", v: true } }));
    h.hit(41865, 10);
    expect(h.meter.snapshot()!.party?.sort()).toEqual(["pesimist", "woee"]);
  });

  it("reads PartyJoined names for members not yet in view", () => {
    const decoder = new PhotonDecoder();
    const [msg] = decoder.decodePacket(
      packet([reliable(eventMessage(230, { 8: bytes(concat(guid(4), guid(5))), 9: { t: "y", el: "s", v: ["woee", "WomanTrader"] } }))]),
      1,
    );
    expect(readPartyUpdate(msg)).toMatchObject({ kind: "roster", names: new Map([["04".repeat(16), "woee"], ["05".repeat(16), "WomanTrader"]]) });
  });
});
