import { describe, expect, it } from "vitest";
import { eventMessage, f, i, k, l, packet, reliable, responseMessage, s, type Typed } from "@/test/photon-encoder";
import { DamageMeter } from "./meter";
import { PhotonDecoder } from "./photon";
import { summarizeSession, type DamageConfig } from "./types";

const config: DamageConfig = {
  version: 1,
  identity: [
    { signature: "response:2", nameKey: 2, idKey: 0 },
    { signature: "event:29", nameKey: 1, idKey: 0 },
  ],
  health: { signature: "event:6", causerKey: 6, changeKey: 2, targetKey: 0 },
  calibratedAt: "2026-11-16T00:00:00.000Z",
  source: "auto",
};

/**
 * Live layout (solo dungeon capture): HealthUpdate (6) carries the target's remaining health at key 3 and
 * leaves it out on the killing blow; HealthUpdates (7) batches hits as arrays, small causer ids as bytes.
 */
function harness() {
  const meter = new DamageMeter(config, { autoSession: true, idleMs: 60_000 });
  const decoder = new PhotonDecoder();
  const send = (payload: Uint8Array, at: number) => {
    const messages = decoder.decodePacket(packet([reliable(payload)]), at);
    messages.forEach((m) => meter.handle(m));
    return messages[0];
  };
  send(responseMessage(2, { 0: l(227), 2: s("pesimist"), 8: s("@RANDOMDUNGEON@a") }), 0);
  send(eventMessage(29, { 0: l(300), 1: s("Kaidou") }), 0);
  const hit = (causer: number, target: number, dmg: number, remaining: number | null, at: number) => {
    const params: Record<number, Typed> = { 0: l(target), 1: i(at), 2: f(-dmg), 4: { t: "b", v: 2 }, 6: l(causer), 7: k(3017) };
    if (remaining !== null) params[3] = f(remaining);
    return send(eventMessage(6, params), at);
  };
  return { meter, send, hit };
}

describe("mob kills", () => {
  it("credits the killing blow (no remaining health) to the causer, once per mob", () => {
    const h = harness();
    h.hit(227, 116, 399, 600, 10);
    h.hit(300, 116, 400, 200, 11);
    const kill = h.hit(227, 116, 399, null, 12);
    h.meter.handle(kill); // retransmission / calibration replay
    h.hit(300, 117, 195, null, 13);
    const players = Object.fromEntries(h.meter.snapshot()!.players.map((p) => [p.name, p.kills]));
    expect(players).toEqual({ pesimist: 1, Kaidou: 1 });
    expect(h.meter.snapshot()!.runs!.at(-1)!.kills).toBe(2);
  });

  it("counts batched hits, including byte-array causers and a remaining health of 0", () => {
    const h = harness();
    h.send(eventMessage(7, {
      0: l(142),
      1: { t: "y", el: "i", v: [1, 2] },
      2: { t: "y", el: "f", v: [-49, -203] },
      3: { t: "y", el: "f", v: [170, 0] },
      6: { t: "x", v: new Uint8Array([227, 227]) },
    }), 20);
    const me = h.meter.snapshot()!.players.find((p) => p.name === "pesimist")!;
    expect(me).toMatchObject({ damage: 252, hits: 2, kills: 1 });
  });

  it("never counts a player being knocked down as a kill", () => {
    const h = harness();
    h.hit(9000, 227, 500, null, 30); // a mob downs you
    h.hit(227, 300, 50, null, 31); // PvP hit on a party member
    expect(h.meter.snapshot()?.players.reduce((sum, p) => sum + (p.kills ?? 0), 0) ?? 0).toBe(0);
  });

  it("adds kills to the saved summary", () => {
    const h = harness();
    for (let n = 0; n < 12; n++) h.hit(227, 500 + n, 100, n % 2 ? 50 : null, 40 + n);
    const saved = h.meter.stopSession(100)!;
    expect(summarizeSession(saved).kills).toBe(6);
  });
});
