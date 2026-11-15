/**
 * Calibration: game patches can renumber events, so instead of hard-coding codes we look at traffic where
 * someone fought something and infer:
 *   1. which messages map a player name to an object id ("identity" rules), and
 *   2. which event reports health changes caused by those object ids ("health" rule).
 * Names can be given (manual calibration) or left out (automatic: any character-name-like string is a
 * candidate, and only identities whose ids actually cause hits survive).
 */
import { expandRows, isFloatTag, isIdTag, isObjectIdLike } from "./extract";
import { messageSignature, type PhotonMessage } from "./photon";
import type { DamageConfig, HealthRule, IdentityRule } from "./types";

const CODE_KEYS = new Set([252, 253]);

export type HealthCandidate = {
  rule: HealthRule;
  /** Rows where a known player caused a negative change. */
  damageRows: number;
  /** Of those, rows that also name a non-player object (a mob) on any key. */
  targetedRows: number;
  /** Of those, rows whose subject (key 0) is a non-player — the main ranking criterion. */
  subjectMobRows: number;
  healRows: number;
  totalRows: number;
  /** Per-player preview: damage dealt / healing done during the recording. */
  byName: { name: string; damage: number; heal: number; hits: number }[];
  /** A few of the raw negative values, so the user can compare with numbers seen in game. */
  sampleDamage: number[];
};

export type IdentityCandidate = { rule: IdentityRule; names: string[]; ids: number };

export type CalibrationResult = {
  messageCount: number;
  eventSignatureCount: number;
  namesFound: string[];
  namesMissing: string[];
  identity: IdentityCandidate[];
  health: HealthCandidate[];
  /** Config built from the top health candidate and the identity rules whose ids it uses; null if nothing fits. */
  suggested: DamageConfig | null;
};

type HealthAcc = {
  rule: Omit<HealthRule, "targetKey">;
  damageRows: number;
  healRows: number;
  totalRows: number;
  byName: Map<string, { damage: number; heal: number; hits: number }>;
  causerIds: Map<number, number>;
  sampleDamage: number[];
  targetKeyHits: Map<number, number>;
};

/** Albion character names: 3–16 letters/digits with at least one letter. */
const CHARACTER_NAME = /^(?=.*[A-Za-z])[A-Za-z0-9]{3,16}$/;
const NOT_NAMES = new Set(["system", "true", "false", "null"]);

export function looksLikeCharacterName(v: string): boolean {
  return CHARACTER_NAME.test(v) && !NOT_NAMES.has(v.toLowerCase());
}

export function analyzeCalibration(
  messages: readonly PhotonMessage[],
  names: readonly string[] | null,
  now: number,
  /** Ids already known from earlier traffic (e.g. the live meter), so players who joined before the window still count. */
  knownIds?: ReadonlyMap<number, string>,
): CalibrationResult {
  const wanted = names
    ? new Map(names.map((n) => [n.trim().toLowerCase(), n.trim()] as const).filter(([k]) => k.length > 0))
    : null;
  const nameFor = (v: string): string | undefined => (wanted ? wanted.get(v.toLowerCase()) : looksLikeCharacterName(v) ? v : undefined);
  const found = new Set<string>();

  // 1) Identity candidates: a string param equal to a known name + an object-id-like integer param.
  const identity = new Map<string, { rule: IdentityRule; names: Set<string>; pairs: Map<number, string> }>();
  for (const m of messages) {
    for (const [nameKey, v] of m.params) {
      if (typeof v !== "string") continue;
      const display = nameFor(v);
      if (!display) continue;
      found.add(display);
      for (const [idKey, id] of m.params) {
        if (idKey === nameKey || CODE_KEYS.has(idKey) || !isIdTag(m.types.get(idKey)) || !isObjectIdLike(id)) continue;
        const rule: IdentityRule = { signature: messageSignature(m), nameKey, idKey };
        const key = `${rule.signature}|${nameKey}|${idKey}`;
        let acc = identity.get(key);
        if (!acc) identity.set(key, (acc = { rule, names: new Set(), pairs: new Map() }));
        acc.names.add(v);
        acc.pairs.set(id, v);
      }
    }
  }

  const playerIds = new Map<number, string>();
  for (const acc of identity.values()) for (const [id, name] of acc.pairs) if (!playerIds.has(id)) playerIds.set(id, name);
  if (knownIds) for (const [id, name] of knownIds) if (!playerIds.has(id)) playerIds.set(id, name);

  // 2) Health candidates: an event with a float param and an id param that points at a known player.
  const health = new Map<string, HealthAcc>();
  const eventSigs = new Set<string>();
  for (const m of messages) {
    if (m.kind !== "event") continue;
    eventSigs.add(messageSignature(m));
    if (playerIds.size === 0) continue;
    const floatKeys = [...m.types].filter(([k, t]) => !CODE_KEYS.has(k) && isFloatTag(t)).map(([k]) => k);
    if (floatKeys.length === 0) continue;
    const intKeys = [...m.types].filter(([k, t]) => !CODE_KEYS.has(k) && isIdTag(t)).map(([k]) => k);
    const causerKeys = intKeys.filter((k) => {
      const v = m.params.get(k);
      return Array.isArray(v) ? v.some((x) => isObjectIdLike(x) && playerIds.has(x)) : isObjectIdLike(v) && playerIds.has(v);
    });

    for (const causerKey of causerKeys) {
      for (const changeKey of floatKeys) {
        // A batched event carries parallel arrays for every field. An array of floats next to a single
        // causer is something else — e.g. the spell-cast event's [x, y] position next to the caster id.
        if (Array.isArray(m.params.get(changeKey)) !== Array.isArray(m.params.get(causerKey))) continue;
        const sig = messageSignature(m);
        const key = `${sig}|${causerKey}|${changeKey}`;
        let acc = health.get(key);
        if (!acc) {
          acc = {
            rule: { signature: sig, causerKey, changeKey },
            damageRows: 0,
            healRows: 0,
            totalRows: 0,
            byName: new Map(),
            causerIds: new Map(),
            sampleDamage: [],
            targetKeyHits: new Map(),
          };
          health.set(key, acc);
        }
        for (const row of expandRows(m.params, [causerKey, changeKey, ...intKeys])) {
          acc.totalRows++;
          const causer = row.get(causerKey);
          const change = row.get(changeKey);
          if (!isObjectIdLike(causer) || typeof change !== "number" || !Number.isFinite(change) || change === 0) continue;
          const name = playerIds.get(causer);
          if (!name) continue;
          acc.causerIds.set(causer, (acc.causerIds.get(causer) ?? 0) + 1);
          const p = acc.byName.get(name) ?? { damage: 0, heal: 0, hits: 0 };
          if (change < 0) {
            acc.damageRows++;
            p.damage += -change;
            p.hits++;
            if (acc.sampleDamage.length < 8) acc.sampleDamage.push(Math.round(-change));
            // Target: another object id on the same row that is not the causer (the mob being hit).
            for (const k of intKeys) {
              const t = row.get(k);
              if (k !== causerKey && isObjectIdLike(t) && t !== causer && !playerIds.has(t)) {
                acc.targetKeyHits.set(k, (acc.targetKeyHits.get(k) ?? 0) + 1);
              }
            }
          } else {
            acc.healRows++;
            p.heal += change;
          }
          acc.byName.set(name, p);
        }
      }
    }
  }

  // Ranking heuristics (the user still confirms):
  //  1. Albion events put their subject object id at key 0. For a hit, the subject is the mob, not the
  //     player — look-alike events such as energy/mana updates have the player itself there.
  //  2. Rows where a player hit some non-player object on any key.
  //  3. Plain count of player-caused negative changes.
  const subjectIsMob = (a: HealthAcc) => a.targetKeyHits.get(0) ?? 0;
  const targeted = (a: HealthAcc) => Math.max(0, ...a.targetKeyHits.values());
  const healthCandidates = [...health.values()]
    .filter((a) => a.damageRows > 0)
    .sort(
      (a, b) =>
        subjectIsMob(b) - subjectIsMob(a) ||
        targeted(b) - targeted(a) ||
        b.damageRows - a.damageRows ||
        b.totalRows - a.totalRows,
    )
    .slice(0, 5)
    .map((a) => {
      const [bestTarget] = [...a.targetKeyHits].sort((x, y) => y[1] - x[1]);
      const targetKey = bestTarget && bestTarget[1] >= a.damageRows * 0.5 ? bestTarget[0] : null;
      return {
        candidate: {
          rule: { ...a.rule, targetKey },
          damageRows: a.damageRows,
          targetedRows: targeted(a),
          subjectMobRows: subjectIsMob(a),
          healRows: a.healRows,
          totalRows: a.totalRows,
          byName: [...a.byName].map(([name, v]) => ({ name, ...v })).sort((x, y) => y.damage - x.damage),
          sampleDamage: a.sampleDamage,
        } satisfies HealthCandidate,
        causerIds: a.causerIds,
      };
    });

  const identityCandidates: IdentityCandidate[] = [...identity.values()]
    .map((a) => ({ rule: a.rule, names: [...a.names], ids: a.pairs.size }))
    .sort((a, b) => b.names.length - a.names.length || b.ids - a.ids);

  let suggested: DamageConfig | null = null;
  const top = healthCandidates[0];
  if (top) {
    // One identity rule per message type. The id key is the one whose ids cause the most hits; among name
    // keys, the character name is the one that is unique per id (a guild/alliance name repeats across
    // players), and on a tie (e.g. the join reply, which only carries you) the lowest key wins.
    type Scored = { rule: IdentityRule; hits: number; distinct: number };
    const best = new Map<string, Scored>();
    const better = (a: Scored, b: Scored) =>
      a.hits !== b.hits ? a.hits > b.hits : a.distinct !== b.distinct ? a.distinct > b.distinct : a.rule.nameKey < b.rule.nameKey;
    for (const a of identity.values()) {
      let hits = 0;
      for (const id of a.pairs.keys()) hits += top.causerIds.get(id) ?? 0;
      if (hits === 0) continue;
      const scored: Scored = { rule: a.rule, hits, distinct: a.names.size / a.pairs.size };
      const current = best.get(a.rule.signature);
      if (!current || better(scored, current)) best.set(a.rule.signature, scored);
    }
    const rules = [...best.values()].sort((x, y) => y.hits - x.hits).map((b) => b.rule);
    if (rules.length > 0) {
      suggested = {
        version: 1,
        identity: rules.slice(0, 10),
        health: top.candidate.rule,
        calibratedAt: new Date(now).toISOString(),
        source: names ? "manual" : "auto",
      };
    }
  }

  return {
    messageCount: messages.length,
    eventSignatureCount: eventSigs.size,
    namesFound: [...found].slice(0, 50),
    namesMissing: wanted ? [...wanted.values()].filter((n) => !found.has(n)) : [],
    identity: identityCandidates.slice(0, 10),
    health: healthCandidates.map((h) => h.candidate),
    suggested,
  };
}

/** Builds a config for a non-top candidate the user picked in the UI. */
export function configFor(result: CalibrationResult, healthIndex: number, now: number): DamageConfig | null {
  const h = result.health[healthIndex];
  if (!h || result.identity.length === 0) return null;
  const used = new Set(h.byName.map((b) => b.name.toLowerCase()));
  const rules = result.identity.filter((c) => c.names.some((n) => used.has(n.toLowerCase()))).map((c) => c.rule);
  if (rules.length === 0) return null;
  return { version: 1, identity: rules.slice(0, 10), health: h.rule, calibratedAt: new Date(now).toISOString(), source: "manual" };
}

/** Minimum evidence before a calibration is applied without asking. */
export const AUTO_MIN_ROWS = 15;

/**
 * True when the top candidate is clearly the hit event: enough player→mob hits, and clearly ahead of the
 * runner-up on the "subject is a mob" criterion (look-alike events score ~0 there).
 */
export function isConfident(result: CalibrationResult): boolean {
  const [top, second] = result.health;
  if (!top || !result.suggested) return false;
  if (top.subjectMobRows < AUTO_MIN_ROWS || top.damageRows < AUTO_MIN_ROWS) return false;
  return !second || top.subjectMobRows >= 2 * second.subjectMobRows;
}

export function sameHealthRule(a: HealthRule, b: HealthRule): boolean {
  return a.signature === b.signature && a.causerKey === b.causerKey && a.changeKey === b.changeKey;
}
