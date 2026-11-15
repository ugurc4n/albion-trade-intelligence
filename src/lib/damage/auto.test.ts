import { describe, expect, it } from "vitest";
import { buildScenario, SCENARIO_CODES, SCENARIO_PLAYERS } from "@/test/damage-scenario";
import { eventMessage, f, l, packet, reliable } from "@/test/photon-encoder";
import { AutoCalibrator } from "./auto-calibrator";
import { analyzeCalibration, isConfident, looksLikeCharacterName } from "./calibrate";
import { DamageMeter } from "./meter";
import { PhotonDecoder, type PhotonMessage } from "./photon";
import type { DamageConfig } from "./types";

function decodeAll(packets: Uint8Array[], start = 1_000_000, step = 100): PhotonMessage[] {
  const d = new PhotonDecoder();
  return packets.flatMap((p, n) => d.decodePacket(p, start + n * step));
}

const names = SCENARIO_PLAYERS.map((p) => p.name);

describe("character name detection", () => {
  it("accepts Albion-style names and rejects other strings", () => {
    for (const n of ["Ugur", "Tashikoma", "Gotiksevici", "Ali2"]) expect(looksLikeCharacterName(n)).toBe(true);
    for (const n of ["", "ab", "1234", "System", "Static Guild", "HIGHLAND_GREEN_MARKETPLACE", "https://discord.gg/x", "x".repeat(17)]) {
      expect(looksLikeCharacterName(n)).toBe(false);
    }
  });
});

describe("analyzeCalibration without names", () => {
  const scenario = buildScenario();
  const result = analyzeCalibration(decodeAll(scenario.packets), null, 0);

  it("finds players and the hit event on its own, confidently", () => {
    expect(result.suggested?.health).toEqual({ signature: `event:${SCENARIO_CODES.health}`, causerKey: 6, changeKey: 2, targetKey: 0 });
    expect(result.suggested?.source).toBe("auto");
    expect(result.namesFound).toEqual(expect.arrayContaining(names));
    expect(isConfident(result)).toBe(true);
  });

  it("is not confident on a handful of hits", () => {
    const tiny = analyzeCalibration(decodeAll(buildScenario({ hits: 6 }).packets), null, 0);
    expect(isConfident(tiny)).toBe(false);
  });
});

describe("DamageMeter auto session", () => {
  const scenario = buildScenario({ seed: 3, hits: 90 });
  const messages = decodeAll(scenario.packets, 1_000_000, 100);
  const config = analyzeCalibration(decodeAll(buildScenario().packets), null, 0).suggested!;

  it("starts on the first player hit and closes after the idle period", () => {
    const meter = new DamageMeter(config, { autoSession: true, idleMs: 60_000, newId: (at) => `auto-${at}` });
    messages.forEach((m) => meter.handle(m));
    const live = meter.snapshot()!;
    expect(live.auto).toBe(true);
    expect(live.startedAt).toBeGreaterThan(1_000_000); // first hit, not first packet
    const last = messages[messages.length - 1].at;
    expect(meter.tick(last + 30_000)).toEqual({ saved: null, discarded: false }); // still within idle window
    const { saved } = meter.tick(last + 120_000);
    expect(saved).not.toBeNull();
    expect(saved!.endedAt).toBeLessThanOrEqual(last); // ends at the last activity, not when the timer fired
    const byName = Object.fromEntries(saved!.players.map((p) => [p.name, p.damage]));
    for (const n of names) expect(byName[n]).toBeCloseTo(scenario.expected[n].damage, 3);
    expect(meter.snapshot()).toBeNull();
  });

  it("does not auto-start when disabled and never auto-closes a manual session", () => {
    const meter = new DamageMeter(config, { autoSession: false, idleMs: 1000 });
    messages.forEach((m) => meter.handle(m));
    expect(meter.snapshot()).toBeNull();
    meter.startSession("m", "Manual", 0);
    messages.forEach((m) => meter.handle(m));
    expect(meter.tick(Number.MAX_SAFE_INTEGER).saved).toBeNull();
    expect(meter.snapshot()).not.toBeNull();
  });

  it("discards tiny auto sessions (a few stray hits)", () => {
    const meter = new DamageMeter(config, { autoSession: true, idleMs: 1000, minHits: 10 });
    const d = new PhotonDecoder();
    d.decodePacket(packet([reliable(eventMessage(SCENARIO_CODES.newCharacter, { 0: l(102), 1: { t: "s", v: "Ali" } }))]), 0).forEach((m) =>
      meter.handle(m),
    );
    d.decodePacket(packet([reliable(eventMessage(SCENARIO_CODES.health, { 0: l(9001), 2: f(-50), 6: l(102) }))]), 10).forEach((m) =>
      meter.handle(m),
    );
    expect(meter.snapshot()?.auto).toBe(true);
    expect(meter.tick(5000)).toEqual({ saved: null, discarded: true });
    expect(meter.snapshot()).toBeNull();
  });

  it("tracks your own name from the join reply", () => {
    const meter = new DamageMeter(config);
    messages.forEach((m) => meter.handle(m));
    expect(meter.selfName).toBe("Ugur");
  });
});

describe("AutoCalibrator", () => {
  const scenario = buildScenario({ seed: 5, hits: 80 });
  const messages = decodeAll(scenario.packets);

  it("waits until there is enough evidence, then applies a config; replay recovers the early hits", () => {
    const cal = new AutoCalibrator();
    cal.push(decodeAll(buildScenario({ hits: 4 }).packets));
    expect(cal.evaluate(null, 0)).toBeNull();
    expect(cal.status.state).toBe("waiting");

    const cal2 = new AutoCalibrator();
    cal2.push(messages);
    const decision = cal2.evaluate(null, 0)!;
    expect(decision.reason).toBe("initial");
    expect(decision.config.source).toBe("auto");

    // Replaying the buffer into a fresh meter counts everything seen before calibration finished.
    const meter = new DamageMeter(decision.config, { autoSession: true, idleMs: 60_000 });
    cal2.messages().forEach((m) => meter.handle(m));
    const byName = Object.fromEntries(meter.snapshot()!.players.map((p) => [p.name, p.damage]));
    for (const n of names) expect(byName[n]).toBeCloseTo(scenario.expected[n].damage, 3);
  });

  it("keeps a working config, adds missing identity rules, and replaces a config that lost the hits", () => {
    const cal = new AutoCalibrator();
    cal.push(messages);
    const good = cal.evaluate(null, 0)!.config;

    expect(cal.evaluate(good, 1)).toBeNull();
    expect(cal.status.state).toBe("ok");

    const withoutSelf: DamageConfig = { ...good, identity: good.identity.filter((r) => !r.signature.startsWith("response")) };
    const added = cal.evaluate(withoutSelf, 2)!;
    expect(added.reason).toBe("identity-added");
    expect(added.config.identity).toHaveLength(good.identity.length);
    expect(added.config.health).toEqual(withoutSelf.health);

    const stale: DamageConfig = { ...good, health: { ...good.health, signature: "event:999" } };
    expect(cal.evaluate(stale, 3)?.reason).toBe("recalibrated");

    // An old code that now lands on the energy look-alike is outclassed by the real hit event.
    const lookAlike: DamageConfig = { ...good, health: { signature: `event:${SCENARIO_CODES.energy}`, causerKey: 6, changeKey: 2, targetKey: null } };
    const fixed = cal.evaluate(lookAlike, 4)!;
    expect(fixed.reason).toBe("recalibrated");
    expect(fixed.config.health.signature).toBe(`event:${SCENARIO_CODES.health}`);
  });

  it("drops messages older than its window", () => {
    const cal = new AutoCalibrator();
    cal.push(decodeAll(buildScenario({ hits: 10 }).packets, 0, 10));
    cal.push(decodeAll(buildScenario({ hits: 10 }).packets, 10 * 60_000, 10));
    expect(Math.min(...cal.messages().map((m) => m.at))).toBeGreaterThanOrEqual(10 * 60_000 - 3 * 60_000);
  });
});

describe("identity rule selection", () => {
  it("keeps one rule per message type and never maps a player to their guild name", () => {
    const r = analyzeCalibration(decodeAll(buildScenario().packets), null, 0);
    const rules = r.suggested!.identity.map((x) => `${x.signature}|${x.nameKey}|${x.idKey}`).sort();
    expect(rules).toEqual([`event:${SCENARIO_CODES.newCharacter}|1|0`, `response:${SCENARIO_CODES.join}|2|0`]);
    const meter = new DamageMeter(r.suggested!, { autoSession: true });
    decodeAll(buildScenario().packets).forEach((m) => meter.handle(m));
    expect(meter.selfName).toBe("Ugur");
    expect(meter.snapshot()!.players.map((p) => p.name).sort()).toEqual([...names].sort());
  });
});

describe("live-traffic look-alikes", () => {
  it("never takes a spell-cast position array for damage", () => {
    const r = analyzeCalibration(decodeAll(buildScenario({ hits: 90 }).packets), null, 0);
    expect(r.health.some((h) => h.rule.signature === "event:113")).toBe(false);
    expect(r.suggested?.health.signature).toBe(`event:${SCENARIO_CODES.health}`);
  });

  it("keeps a manual config even when it stops matching, and flags it as stale", () => {
    const cal = new AutoCalibrator();
    cal.push(decodeAll(buildScenario({ hits: 80 }).packets));
    const good = cal.evaluate(null, 0)!.config;
    const manualStale: DamageConfig = { ...good, source: "manual", health: { ...good.health, signature: "event:999" } };
    expect(cal.evaluate(manualStale, 1)).toBeNull();
    expect(cal.status.state).toBe("stale");
  });

  it("recognises hits by players whose identity message fell out of the window", () => {
    const msgs = decodeAll(buildScenario({ hits: 60 }).packets).filter((m) => m.kind === "event" && m.code !== SCENARIO_CODES.newCharacter);
    const withoutIds = msgs.filter((m) => !(m.kind === "event" && m.code === SCENARIO_CODES.newCharacter));
    const known = new Map(SCENARIO_PLAYERS.map((p) => [p.id as number, p.name as string]));
    expect(analyzeCalibration(withoutIds, null, 0).health[0]?.byName.length ?? 0).toBe(0);
    const r = analyzeCalibration(withoutIds, null, 0, known);
    expect(r.health[0].rule.signature).toBe(`event:${SCENARIO_CODES.health}`);
    expect(r.health[0].byName.map((b) => b.name).sort()).toEqual([...names].sort());
  });
});
