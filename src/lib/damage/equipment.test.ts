import { describe, expect, it } from "vitest";
import { getCatalogItem } from "@/lib/catalog/catalog";
import { eventMessage, f, l, packet, reliable, responseMessage, s, type Typed } from "@/test/photon-encoder";
import { DamageMeter } from "./meter";
import { PhotonDecoder, type PhotonMessage } from "./photon";
import type { DamageConfig } from "./types";

const config: DamageConfig = {
  version: 1,
  source: "manual",
  calibratedAt: new Date(0).toISOString(),
  identity: [{ signature: "event:29", idKey: 0, nameKey: 1 }, { signature: "response:2", idKey: 0, nameKey: 2 }],
  health: { signature: "event:6", causerKey: 6, changeKey: 2, targetKey: 0 },
};
const sword = getCatalogItem("T4_MAIN_SWORD")!;
const bow = getCatalogItem("T4_2H_BOW@2")!;
const armor = getCatalogItem("T4_ARMOR_PLATE_SET1")!;
const gear = (index: number): Typed => ({ t: "y", el: "k", v: [index, 0, 0, 0, 0, 0, 0, 0, 0, 0] });

function harness(withConfig = true) {
  const meter = new DamageMeter(withConfig ? config : null);
  const decoder = new PhotonDecoder();
  const send = (payload: Uint8Array, at: number) => {
    const messages = decoder.decodePacket(packet([reliable(payload)]), at);
    messages.forEach((msg) => meter.handle(msg));
    return messages[0];
  };
  return {
    meter,
    send,
    join: (id: number, name: string, index: number | undefined, at: number) => {
      const params: Record<number, Typed> = { 0: l(id), 1: s(name) };
      if (index !== undefined) params[40] = gear(index);
      return send(eventMessage(29, params), at);
    },
    change: (id: number, index: number, at: number) => send(eventMessage(90, { 0: l(id), 2: gear(index) }), at),
    hit: (id: number, at: number) => send(eventMessage(6, { 0: l(9001), 2: f(-100), 6: l(id) }), at),
    player: (name = "Alice") => meter.snapshot()!.players.find((player) => player.name === name)!,
  };
}

describe("Damage Meter Main Hand tracking", () => {
  it("resolves the equipped weapon and enchantment from decoded character/equipment packets", () => {
    const h = harness();
    h.join(101, "Alice", sword.index, 1);
    h.meter.startSession("fight", "Fight", 2);
    h.hit(101, 3);
    expect(h.player().mainHand?.item).toEqual({ id: sword.id, nameEn: sword.nameEn, tier: 4, enchant: 0 });

    h.change(101, bow.index!, 4);
    h.hit(101, 5);
    expect(h.player()).toMatchObject({ damage: 200, hits: 2, mainHand: { item: { id: bow.id, enchant: 2 }, observedAt: 4 } });
  });

  it("keeps early equipment updates for the local player until identity calibration is available", () => {
    const h = harness(false);
    h.change(101, sword.index!, 1);
    h.meter.setConfig(config);
    h.send(responseMessage(2, { 0: l(101), 2: s("Alice") }), 2);
    h.meter.startSession("self", "Self", 3);
    h.hit(101, 4);
    expect(h.meter.selfName).toBe("Alice");
    expect(h.player().mainHand?.item?.id).toBe(sword.id);
  });

  it("distinguishes unknown equipment, an empty Main Hand, and an unknown item index", () => {
    const h = harness();
    h.meter.startSession("empty", "Empty", 0);
    h.join(101, "Alice", undefined, 1);
    h.hit(101, 2);
    expect(h.player().mainHand).toBeNull();
    h.change(101, 0, 3);
    expect(h.player().mainHand).toEqual({ item: null, observedAt: 3 });
    h.change(101, sword.index!, 4);
    expect(h.player().mainHand?.item?.id).toBe(sword.id);
    h.change(101, 30000, 5);
    expect(h.player().mainHand).toBeNull();
  });

  it("does not treat spells, positions, inventory items or malformed arrays as weapon updates", () => {
    const h = harness();
    h.join(101, "Alice", sword.index, 1);
    h.meter.startSession("decoys", "Decoys", 2);
    h.hit(101, 3);
    h.send(eventMessage(11, { 0: l(101), 2: { t: "y", el: "f", v: [bow.index!, ...Array(9).fill(0)] } }), 4);
    h.send(eventMessage(90, { 0: l(101), 2: { t: "y", el: "k", v: [bow.index!] } }), 5);
    h.send(eventMessage(90, { 0: l(101), 2: { t: "y", el: "f", v: [bow.index!, ...Array(9).fill(0)] } }), 6);
    expect(h.player().mainHand?.item?.id).toBe(sword.id);
    h.change(101, armor.index!, 7);
    expect(h.player().mainHand).toBeNull();
  });

  it("accepts an empty byte-array loadout from NewCharacter packets", () => {
    const h = harness();
    h.meter.startSession("bytes", "Bytes", 0);
    h.send(eventMessage(29, { 0: l(101), 1: s("Alice"), 40: { t: "x", v: new Uint8Array(10) } }), 1);
    h.hit(101, 2);
    expect(h.player().mainHand).toEqual({ item: null, observedAt: 1 });
  });

  it("does not reuse another player's weapon when the game reassigns an object id", () => {
    const h = harness();
    h.meter.startSession("reuse", "Reuse", 0);
    h.join(101, "Alice", sword.index, 1);
    h.hit(101, 2);
    h.join(101, "Bob", undefined, 3);
    h.hit(101, 4);
    expect(h.player("Bob").mainHand).toBeNull();
    expect(h.player("Alice").mainHand?.item?.id).toBe(sword.id);
  });

  it("ignores older equipment replay and preserves independent saved snapshots", () => {
    const h = harness();
    h.meter.startSession("history", "History", 0);
    const oldIdentity = h.join(101, "Alice", sword.index, 1);
    h.hit(101, 2);
    h.change(101, bow.index!, 10);
    h.meter.learnIdentities(oldIdentity as PhotonMessage);
    h.change(101, sword.index!, 3);
    expect(h.player().mainHand?.item?.id).toBe(bow.id);
    const saved = h.meter.stopSession(11)!;
    h.change(101, sword.index!, 12);
    h.meter.startSession("next", "Next", 13);
    h.hit(101, 14);
    expect(h.player().mainHand?.item?.id).toBe(sword.id);
    expect(JSON.parse(JSON.stringify(saved)).players[0].mainHand.item.id).toBe(bow.id);
  });

  it("does not let an older object id overwrite the latest loadout after a zone change", () => {
    const h = harness();
    h.meter.startSession("zone", "Zone", 0);
    h.join(101, "Alice", sword.index, 1);
    h.hit(101, 2);
    h.join(201, "Alice", bow.index, 10);
    h.hit(201, 11);
    h.change(101, sword.index!, 4);
    expect(h.player().mainHand?.item?.id).toBe(bow.id);
  });
});
