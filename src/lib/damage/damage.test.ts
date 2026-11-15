import { describe, expect, it } from "vitest";
import { buildScenario, SCENARIO_CODES, SCENARIO_PLAYERS } from "@/test/damage-scenario";
import { eventMessage, f, l, packet, reliable } from "@/test/photon-encoder";
import { analyzeCalibration, configFor } from "./calibrate";
import { DamageMeter } from "./meter";
import { PhotonDecoder, type PhotonMessage } from "./photon";
import { damageConfigSchema } from "./types";

function decodeAll(packets: Uint8Array[]): PhotonMessage[] {
  const d = new PhotonDecoder();
  return packets.flatMap((p, n) => d.decodePacket(p, 1_000_000 + n * 100));
}

const names = SCENARIO_PLAYERS.map((p) => p.name);

describe("analyzeCalibration", () => {
  const scenario = buildScenario();
  const messages = decodeAll(scenario.packets);
  const result = analyzeCalibration(messages, [...names, "Nobody"], 0);

  it("finds the identity messages for every named player and reports missing names", () => {
    expect(result.namesFound.sort()).toEqual([...names].sort());
    expect(result.namesMissing).toEqual(["Nobody"]);
    const sigs = result.suggested!.identity.map((r) => `${r.signature}|${r.nameKey}|${r.idKey}`).sort();
    expect(sigs).toEqual([`event:${SCENARIO_CODES.newCharacter}|1|0`, `response:${SCENARIO_CODES.join}|2|0`]);
  });

  it("picks the real health event over the energy look-alike and detects the target key", () => {
    expect(result.health[0].rule).toEqual({ signature: `event:${SCENARIO_CODES.health}`, causerKey: 6, changeKey: 2, targetKey: 0 });
    expect(result.health.some((h) => h.rule.signature === `event:${SCENARIO_CODES.energy}`)).toBe(true);
    expect(result.suggested!.health).toEqual(result.health[0].rule);
    expect(damageConfigSchema.safeParse(result.suggested).success).toBe(true);
  });

  it("previews per-player damage that matches what was dealt", () => {
    const preview = Object.fromEntries(result.health[0].byName.map((b) => [b.name, b.damage]));
    for (const n of names) expect(preview[n]).toBeGreaterThanOrEqual(scenario.expected[n].damage);
    expect(result.health[0].sampleDamage.length).toBeGreaterThan(0);
  });

  it("can build a config for another candidate the user picks", () => {
    const alt = configFor(result, 1, 0);
    expect(alt?.health.signature).toBe(result.health[1].rule.signature);
  });

  it("returns no suggestion when no named player is in the recording", () => {
    const empty = analyzeCalibration(messages, ["Stranger"], 0);
    expect(empty.suggested).toBeNull();
    expect(empty.health).toEqual([]);
  });
});

describe("DamageMeter", () => {
  const scenario = buildScenario({ seed: 11, hits: 90 });
  const messages = decodeAll(scenario.packets);
  const config = analyzeCalibration(decodeAll(buildScenario().packets), names, 0).suggested!;

  it("does nothing before a session starts or without a config", () => {
    const meter = new DamageMeter(null);
    messages.forEach((m) => meter.handle(m));
    expect(meter.snapshot()).toBeNull();
  });

  it("sums damage dealt, healing and damage taken per player name", () => {
    const meter = new DamageMeter(config);
    meter.startSession("s1", "Test", 0);
    messages.forEach((m) => meter.handle(m));
    const snap = meter.stopSession(10_000)!;
    expect(snap.endedAt).toBe(10_000);
    const byName = Object.fromEntries(snap.players.map((p) => [p.name, p]));
    for (const n of names) {
      expect(byName[n].damage).toBeCloseTo(scenario.expected[n].damage, 3);
      expect(byName[n].taken).toBeCloseTo(scenario.expected[n].taken, 3);
      expect(byName[n].heal).toBeCloseTo(scenario.expected[n].heal, 3);
    }
    expect(snap.unattributedDamage).toBeCloseTo(scenario.unattributed, 3);
    expect(snap.players[0].damage).toBeGreaterThanOrEqual(snap.players[1].damage);
  });

  it("re-learns object ids after a zone change and ignores hits before identities are known", () => {
    const meter = new DamageMeter(config);
    meter.startSession("s2", "Zone", 0);
    const d = new PhotonDecoder();
    const hit = (causer: number, dmg: number) =>
      d.decodePacket(packet([reliable(eventMessage(SCENARIO_CODES.health, { 0: l(9001), 2: f(-dmg), 6: l(causer) }))]), 1);
    hit(777, 100).forEach((m) => meter.handle(m)); // unknown id → unattributed
    d.decodePacket(packet([reliable(eventMessage(SCENARIO_CODES.newCharacter, { 0: l(777), 1: { t: "s", v: "Ali" } }))]), 2).forEach((m) =>
      meter.handle(m),
    );
    hit(777, 250).forEach((m) => meter.handle(m));
    const snap = meter.snapshot()!;
    expect(snap.players).toEqual([expect.objectContaining({ name: "Ali", damage: 250, hits: 1 })]);
    expect(snap.unattributedDamage).toBe(100);
  });
});
