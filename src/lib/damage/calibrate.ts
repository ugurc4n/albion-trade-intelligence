/**
 * Calibration fallback: game patches can renumber events. Player names come from the fixed, verified join
 * reply and NewCharacter messages (see identity.ts); this only finds which event reports health changes
 * caused by those players, so the meter keeps working if a patch moves the hit event.
 */
import { expandRows, isFloatTag, isIdTag, isObjectIdLike } from "./extract";
import { readJoin, readNewCharacter } from "./identity";
import { messageSignature, type PhotonMessage } from "./photon";
import type { DamageConfig, HealthRule } from "./types";

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

export type CalibrationResult = {
  messageCount: number;
  eventSignatureCount: number;
  /** Characters announced in the recording (join reply and NewCharacter). */
  playersFound: string[];
  health: HealthCandidate[];
  /** Config built from the top health candidate; null if nothing fits. */
  suggested: DamageConfig | null;
};

type HealthAcc = {
  rule: Omit<HealthRule, "targetKey">;
  damageRows: number;
  healRows: number;
  totalRows: number;
  byName: Map<string, { damage: number; heal: number; hits: number }>;
  sampleDamage: number[];
  targetKeyHits: Map<number, number>;
};

export function analyzeCalibration(
  messages: readonly PhotonMessage[],
  now: number,
  /** Ids already known from earlier traffic (e.g. the live meter), so players who joined before the window still count. */
  knownIds?: ReadonlyMap<number, string>,
): CalibrationResult {
  const playerIds = new Map<number, string>();
  for (const m of messages) {
    const who = readJoin(m) ?? readNewCharacter(m);
    if (who) playerIds.set(who.id, who.name);
  }
  const found = new Set(playerIds.values());
  if (knownIds) for (const [id, name] of knownIds) if (!playerIds.has(id)) playerIds.set(id, name);

  // Health candidates: an event with a float param and an id param that points at a known player.
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
      };
    });

  const top = healthCandidates[0];
  const suggested: DamageConfig | null = top
    ? { version: 1, identity: [], health: top.candidate.rule, calibratedAt: new Date(now).toISOString(), source: "auto" }
    : null;

  return {
    messageCount: messages.length,
    eventSignatureCount: eventSigs.size,
    playersFound: [...found].slice(0, 50),
    health: healthCandidates.map((h) => h.candidate),
    suggested,
  };
}

/** Builds a config for a non-top candidate the user picked in the UI. */
export function configFor(result: CalibrationResult, healthIndex: number, now: number): DamageConfig | null {
  const h = result.health[healthIndex];
  return h ? { version: 1, identity: [], health: h.rule, calibratedAt: new Date(now).toISOString(), source: "manual" } : null;
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
