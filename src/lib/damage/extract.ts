import type { PhotonValue } from "./protocol18";

/** Albion object ids are small positive integers; timestamps/ticks are far larger. */
export function isObjectIdLike(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v < 2 ** 31;
}

export function isFloatTag(tag: string | undefined): boolean {
  return tag === "f" || tag === "d" || tag === "y:f" || tag === "y:d";
}

/**
 * Albion sends object ids as Protocol18 compressed longs ("l"); small ints/bytes/shorts in the same messages
 * are counters, flags or spell ids. Restricting ids to longs keeps those out of identity/causer detection.
 */
export function isIdTag(tag: string | undefined): boolean {
  return tag === "l" || tag === "y:l";
}

export function isIntTag(tag: string | undefined): boolean {
  return tag === "b" || tag === "k" || tag === "i" || tag === "l" || tag === "n" || tag === "y:b" || tag === "y:k" || tag === "y:i" || tag === "y:l";
}

/**
 * Batched events carry parallel arrays (e.g. one entry per hit). Expands the chosen keys into rows:
 * scalars repeat on every row, arrays are read index by index (shortest array wins).
 */
export function expandRows(params: Map<number, PhotonValue>, keys: readonly number[]): Map<number, PhotonValue>[] {
  let length = -1;
  for (const k of keys) {
    const v = params.get(k);
    if (Array.isArray(v)) length = length < 0 ? v.length : Math.min(length, v.length);
  }
  if (length < 0) {
    const row = new Map<number, PhotonValue>();
    for (const k of keys) row.set(k, params.get(k) ?? null);
    return [row];
  }
  return Array.from({ length }, (_, i) => {
    const row = new Map<number, PhotonValue>();
    for (const k of keys) {
      const v = params.get(k);
      row.set(k, Array.isArray(v) ? (v[i] ?? null) : (v ?? null));
    }
    return row;
  });
}
