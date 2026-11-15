/**
 * SYNTHETIC fight used by tests and the local pipeline simulator. The event codes and parameter keys are
 * invented for the test and are deliberately NOT assumed to match the live game — calibration has to
 * discover them, which is exactly what the tests check.
 */
import { eventMessage, f, i, k, l, packet, reliable, responseMessage, s, type Typed } from "./photon-encoder";

export const SCENARIO_CODES = { join: 2, newCharacter: 29, health: 6, energy: 8, chat: 63 } as const;
export const SCENARIO_PLAYERS = [
  { name: "Ugur", id: 101 },
  { name: "Ali", id: 102 },
  { name: "Veli", id: 103 },
] as const;
const MOBS = [9001, 9002, 9003];

export type ScenarioHit = { causer: number; target: number; change: number };

export type Scenario = {
  packets: Uint8Array[];
  expected: Record<string, { damage: number; heal: number; taken: number }>;
  unattributed: number;
};

/** Deterministic pseudo-random sequence so totals are stable across runs. */
function rng(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    return x / 2 ** 31;
  };
}

export function buildScenario(opts: { hits?: number; seed?: number } = {}): Scenario {
  const rand = rng(opts.seed ?? 7);
  const hits = opts.hits ?? 60;
  const expected: Scenario["expected"] = Object.fromEntries(SCENARIO_PLAYERS.map((p) => [p.name, { damage: 0, heal: 0, taken: 0 }]));
  let unattributed = 0;
  const packets: Uint8Array[] = [];

  const [self, ...party] = SCENARIO_PLAYERS;
  // Own character arrives in the join response; others via "new character" events (plus a guild id decoy).
  packets.push(packet([reliable(responseMessage(SCENARIO_CODES.join, { 0: l(self.id), 2: s(self.name), 3: i(33), 5: l(424242), 58: s("Nuisance") }))]));
  for (const p of party) {
    packets.push(packet([reliable(eventMessage(SCENARIO_CODES.newCharacter, { 0: l(p.id), 1: s(p.name), 8: s("StaticGuild"), 9: f(12.5), 18: i(p.id) }))]));
  }
  // Guild-style message: name-like string next to small ints (not ids) — must not become an identity.
  packets.push(packet([reliable(eventMessage(103, { 15: s("Nuisance"), 21: i(93), 22: i(2), 23: i(3) }))]));
  // Chat line mentioning a name — must not be mistaken for an identity with an object id.
  packets.push(packet([reliable(eventMessage(SCENARIO_CODES.chat, { 0: s("Ali"), 1: s("pull geliyor") }))]));

  const health = (target: number, causer: number, change: number): Record<number, Typed> => ({
    0: l(target),
    1: i(6954965),
    2: f(change),
    3: f(1000),
    4: { t: "b", v: 2 },
    6: l(causer),
    7: k(3523),
  });

  for (let n = 0; n < hits; n++) {
    const player = SCENARIO_PLAYERS[n % SCENARIO_PLAYERS.length];
    const mob = MOBS[n % MOBS.length];
    const dmg = Math.round(100 + rand() * 300);
    packets.push(packet([reliable(eventMessage(SCENARIO_CODES.health, health(mob, player.id, -dmg)))]));
    expected[player.name].damage += dmg;

    // Look-alike decoy seen in live traffic: spell cast with a new projectile id at key 0, the caster at
    // key 1 and an [x, y] position array (negative world coordinates) at key 2.
    packets.push(
      packet([
        reliable(
          eventMessage(113, { 0: l(50_000 + n), 1: l(player.id), 2: { t: "y", el: "f", v: [-356.33 - n, 210.57] }, 3: f(327.3), 4: k(2957) }),
        ),
      ]),
    );
    // Look-alike decoy: energy spent by the same player (subject = the player itself).
    packets.push(packet([reliable(eventMessage(SCENARIO_CODES.energy, health(player.id, player.id, -(10 + (n % 5)))))]));

    if (n % 4 === 0) {
      const taken = Math.round(50 + rand() * 100);
      packets.push(packet([reliable(eventMessage(SCENARIO_CODES.health, health(player.id, mob, -taken)))]));
      expected[player.name].taken += taken;
    }
    if (n % 6 === 0) {
      const healer = SCENARIO_PLAYERS[2];
      const target = SCENARIO_PLAYERS[0];
      packets.push(packet([reliable(eventMessage(SCENARIO_CODES.health, health(target.id, healer.id, 80)))]));
      expected[healer.name].heal += 80;
    }
    if (n % 10 === 0) {
      // A pet / unseen player (unknown id) hitting a mob.
      packets.push(packet([reliable(eventMessage(SCENARIO_CODES.health, health(mob, 5555, -40)))]));
      unattributed += 40;
    }
  }
  return { packets, expected, unattributed };
}
