import { describe, expect, it } from "vitest";
import { eventMessage, i, l, packet, reliable, responseMessage, s, type Typed } from "@/test/photon-encoder";
import { readItemLoot } from "./loot";
import { DamageMeter } from "./meter";
import { PhotonDecoder } from "./photon";
import { lootSourceLabel } from "./presentation";
import { summarizeSession } from "./types";

/** Live party capture (278 without the silver flag): 1 source, 2 looter, 4 item index (int), 5 quantity (long). */
function harness() {
  const meter = new DamageMeter(null, { autoSession: true, idleMs: 60_000 });
  const decoder = new PhotonDecoder();
  const send = (payload: Uint8Array, at: number) => {
    const messages = decoder.decodePacket(packet([reliable(payload)]), at);
    messages.forEach((m) => meter.handle(m));
    return messages[0];
  };
  const loot = (by: string, index: number, at: number, from = "@MOB_UNDEAD_SOLDIER_CHAMPION", quantity = 1) =>
    send(eventMessage(278, { 0: l(118885), 1: s(from), 2: s(by), 4: i(index), 5: l(quantity) }), at);
  send(responseMessage(2, { 0: l(41865), 2: s("pesimist"), 8: s("DNG-UND-01-MAIN-02") }), 0);
  return { meter, send, loot };
}

describe("item loot", () => {
  it("reads the live layout and ignores silver shares", () => {
    const h = harness();
    const msg = h.loot("WomanTrader", 2005, 10);
    expect(readItemLoot(msg)).toEqual({ at: 10, by: "WomanTrader", from: "@MOB_UNDEAD_SOLDIER_CHAMPION", index: 2005, quantity: 1 });
    const silverFlag: Typed = { t: "o", v: true };
    const silver = h.send(eventMessage(278, { 0: l(1), 2: s("pesimist"), 3: silverFlag, 5: l(2_821_988) }), 11);
    expect(readItemLoot(silver)).toBeNull();
  });

  it("records loot only while a session runs, with the catalog item", () => {
    const h = harness();
    h.loot("Bestianlorry", 2013, 5); // no session yet: loot alone does not start one
    expect(h.meter.snapshot()).toBeNull();
    h.meter.startSession("hunt", "Hunt", 10);
    h.loot("Bestianlorry", 2013, 20);
    h.loot("uk23t", 999_999, 21, "@MOB_UNDEAD_ARCHER_STANDARD", 3); // not in the catalog
    const snap = h.meter.snapshot()!;
    expect(snap.loot).toEqual([
      { at: 20, by: "Bestianlorry", from: "@MOB_UNDEAD_SOLDIER_CHAMPION", index: 2013, quantity: 1,
        item: { id: "T5_RUNE", nameEn: "Expert's Rune", tier: 5, enchant: 0 } },
      { at: 21, by: "uk23t", from: "@MOB_UNDEAD_ARCHER_STANDARD", index: 999_999, quantity: 3, item: null },
    ]);
    expect(summarizeSession(h.meter.stopSession(30)!).lootCount).toBe(4);
  });

  it("does not record a replayed message twice", () => {
    const h = harness();
    h.meter.startSession("hunt", "Hunt", 0);
    const msg = h.loot("woee", 503, 5);
    h.meter.handle(msg);
    expect(h.meter.snapshot()!.loot).toHaveLength(1);
  });

  it("names the source", () => {
    expect(lootSourceLabel("@MOB_UNDEAD_SOLDIER_CHAMPION")).toBe("Undead Soldier Champion");
    expect(lootSourceLabel("DAYI917")).toBe("DAYI917");
    expect(lootSourceLabel("")).toBe("Unknown");
  });
});
