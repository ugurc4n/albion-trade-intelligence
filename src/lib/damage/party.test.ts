import { describe, expect, it } from "vitest";
import { eventMessage, f, i, l, packet, reliable, responseMessage, s } from "@/test/photon-encoder";
import { DamageMeter } from "./meter";
import { PhotonDecoder, type PhotonMessage } from "./photon";
import type { DamageConfig } from "./types";

/**
 * Live layout of a party dungeon run: join reply (response 2), NewCharacter (29: id 0, name 1),
 * HealthUpdate (6: target 0, change 2, causer 6), KnockedDown (165: victim id 0, attacker name 3) and
 * OtherGrabbedLoot (278). The saved auto config below is the one that merged a whole party into "PA".
 */
const savedConfig: DamageConfig = {
  version: 1,
  identity: [
    { signature: "response:2", nameKey: 2, idKey: 0 },
    { signature: "event:278", nameKey: 2, idKey: 0 },
    { signature: "event:29", nameKey: 1, idKey: 0 },
    { signature: "event:165", nameKey: 3, idKey: 0 },
  ],
  health: { signature: "event:6", causerKey: 6, changeKey: 2, targetKey: 0 },
  calibratedAt: "2026-11-15T14:05:07.593Z",
  source: "auto",
};

const ME = { id: 500, name: "pesimist" };
const PARTY = [
  { id: 501, name: "Youngnest" },
  { id: 502, name: "Prodigyyy" },
  { id: 503, name: "Hellhands" },
];
const MOB = 9000;
const GANKER_ID = 777;

function partyRun(opts: { hits: number; knockdowns: boolean; attacker?: string }) {
  const p: Uint8Array[] = [];
  const msg = (payload: Uint8Array) => p.push(packet([reliable(payload)]));
  msg(responseMessage(2, { 0: l(ME.id), 2: s(ME.name) }));
  for (const m of PARTY) msg(eventMessage(29, { 0: l(m.id), 1: s(m.name), 8: s("SomeGuild") }));
  const everyone = [ME, ...PARTY];
  for (let n = 0; n < opts.hits; n++) {
    const who = everyone[n % everyone.length];
    msg(eventMessage(6, { 0: l(MOB + (n % 3)), 1: i(1), 2: f(-100), 6: l(who.id) }));
    if (n % 2 === 0) msg(eventMessage(6, { 0: l(who.id), 1: i(1), 2: f(-10), 6: l(MOB) }));
    // A tag-like string next to a party member's id (the "PA" row).
    if (n % 7 === 0) msg(eventMessage(278, { 0: l(PARTY[0].id), 1: s("Dragon"), 2: s("PA") }));
    if (opts.knockdowns && n % 5 === 0) {
      const victim = PARTY[n % PARTY.length];
      msg(eventMessage(165, { 0: l(victim.id), 2: l(GANKER_ID), 3: s(opts.attacker ?? "Bloodtusk") }));
    }
  }
  return p;
}

function decodeAll(packets: Uint8Array[]): PhotonMessage[] {
  const d = new PhotonDecoder();
  return packets.flatMap((pk, n) => d.decodePacket(pk, 1_000_000 + n * 50));
}

describe("party members keep their own names", () => {
  it("with the saved config, every party member's hits stay under their own name", () => {
    const meter = new DamageMeter(savedConfig, { autoSession: true, idleMs: 60_000 });
    decodeAll(partyRun({ hits: 80, knockdowns: true })).forEach((m) => meter.handle(m));
    const rows = Object.fromEntries(meter.snapshot()!.players.map((p) => [p.name, p.damage]));
    expect(rows).toEqual({ pesimist: 2000, Youngnest: 2000, Prodigyyy: 2000, Hellhands: 2000 });
  });

  it("a zone change lets a reused object id take its new owner's name", () => {
    const meter = new DamageMeter(savedConfig, { autoSession: true, idleMs: 60_000 });
    decodeAll(partyRun({ hits: 4, knockdowns: false })).forEach((m) => meter.handle(m));
    const d = new PhotonDecoder();
    const next = [
      packet([reliable(responseMessage(2, { 0: l(600), 2: s(ME.name) }))]),
      packet([reliable(eventMessage(29, { 0: l(PARTY[1].id), 1: s("Newcomer") }))]),
    ];
    next.forEach((pk) => d.decodePacket(pk, 2_000_000).forEach((m) => meter.handle(m)));
    expect(meter.nameOf(PARTY[1].id)).toBe("Newcomer");
  });
});

describe("names come only from zone entry", () => {
  it("never learns a name from KnockedDown, Died or loot messages, whatever the saved config says", () => {
    const meter = new DamageMeter(savedConfig, { autoSession: true, idleMs: 60_000 });
    const d = new PhotonDecoder();
    const send = (payload: Uint8Array) => d.decodePacket(packet([reliable(payload)]), 1).forEach((m) => meter.handle(m));
    send(eventMessage(165, { 0: l(800), 2: l(801), 3: s("Gankerx"), 4: l(802), 5: s("Victimo") }));
    send(eventMessage(164, { 1: l(803), 2: s("AbuSidra"), 9: l(804), 10: s("Unnamod") }));
    send(eventMessage(278, { 0: l(805), 2: s("uk23t"), 3: { t: "o", v: true }, 5: l(2_821_988) }));
    for (const id of [800, 801, 802, 803, 804, 805]) expect(meter.nameOf(id)).toBeUndefined();
  });
});
