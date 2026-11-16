/**
 * Background calibration from live traffic: keeps the last few minutes of decoded messages and
 * periodically re-runs the analysis without names. It applies a config only when the evidence is
 * unambiguous (see isConfident), and it never replaces a config that is still matching hits.
 */
import { analyzeCalibration, isConfident, sameHealthRule } from "./calibrate";
import type { PhotonMessage } from "./photon";
import type { DamageConfig } from "./types";

const WINDOW_MS = 3 * 60_000;
const MAX_MESSAGES = 40_000;
const INTERVAL_UNCALIBRATED_MS = 10_000;
const INTERVAL_CALIBRATED_MS = 60_000;

export type AutoCalibrationStatus =
  | { state: "waiting"; note: string; checkedAt: number | null }
  | { state: "applied"; reason: AutoReason; at: number }
  | { state: "ok"; checkedAt: number }
  /** A manual config no longer matches hits; it is kept (never replaced automatically) but flagged. */
  | { state: "stale"; note: string; checkedAt: number };

export type AutoReason = "initial" | "recalibrated";
export type AutoDecision = { config: DamageConfig; reason: AutoReason } | null;


export class AutoCalibrator {
  private buffer: PhotonMessage[] = [];
  private lastRunAt: number | null = null;
  status: AutoCalibrationStatus = { state: "waiting", note: "No analysis yet.", checkedAt: null };

  push(messages: readonly PhotonMessage[]) {
    if (messages.length === 0) return;
    for (const m of messages) this.buffer.push(m);
    const newest = messages[messages.length - 1].at;
    let drop = 0;
    while (drop < this.buffer.length && (newest - this.buffer[drop].at > WINDOW_MS || this.buffer.length - drop > MAX_MESSAGES)) drop++;
    if (drop > 0) this.buffer.splice(0, drop);
  }

  /** Buffered messages (oldest first) — replayed into the meter after a new config is applied. */
  messages(): readonly PhotonMessage[] {
    return this.buffer;
  }

  due(now: number, calibrated: boolean): boolean {
    const interval = calibrated ? INTERVAL_CALIBRATED_MS : INTERVAL_UNCALIBRATED_MS;
    return this.lastRunAt === null || now - this.lastRunAt >= interval;
  }

  /** Runs the analysis on the buffer and decides whether to change the config. */
  evaluate(current: DamageConfig | null, now: number, knownIds?: ReadonlyMap<number, string>): AutoDecision {
    this.lastRunAt = now;
    const result = analyzeCalibration(this.buffer, now, knownIds);
    const top = result.health[0];

    if (current) {
      const matching = result.health.find((h) => sameHealthRule(h.rule, current.health) && h.damageRows > 0);
      // Keep the current rule while it matches hits — unless a clearly stronger hit event has appeared
      // (after a patch the old code can land on a look-alike event such as energy updates).
      const outclassed =
        matching && top && isConfident(result) && !sameHealthRule(top.rule, current.health) && matching.subjectMobRows * 2 < top.subjectMobRows;
      const stillMatching = matching && !outclassed;
      if (stillMatching) {
        this.status = { state: "ok", checkedAt: now };
        return null;
      }
      if (!top) {
        // No fighting in the window: nothing to judge the current config by.
        this.status = { state: "ok", checkedAt: now };
        return null;
      }
    }

    if (!isConfident(result)) {
      if (current) {
        // Not enough fighting to judge: keep what we have.
        this.status = { state: "ok", checkedAt: now };
        return null;
      }
      this.status = {
        state: "waiting",
        checkedAt: now,
        note:
          result.health.length === 0
            ? "No player hits seen yet. Change zones and hit a mob."
            : `Hits seen but not clear enough yet (${top.subjectMobRows} hits). Keep fighting a little longer.`,
      };
      return null;
    }

    if (current?.source === "manual") {
      // The user chose this config: never swap it behind their back, only say it looks stale.
      this.status = {
        state: "stale",
        checkedAt: now,
        note: "The saved calibration did not match any hits in the last fight. If the numbers look wrong, click Reset; it will be found again automatically.",
      };
      return null;
    }
    const reason = current ? "recalibrated" : "initial";
    this.status = { state: "applied", reason, at: now };
    return { config: { ...result.suggested!, source: "auto" }, reason };
  }
}
