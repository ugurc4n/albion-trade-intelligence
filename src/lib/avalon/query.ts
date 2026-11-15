import type { AvalonZone, ChestGrade, DungeonKind } from "./types";

export type AvalonFilters = {
  query: string;
  tiers: number[];
  types: string[];
  /** Zone must contain at least one chest of each selected grade. */
  chestGrades: ChestGrade[];
  /** Zone must contain at least one dungeon of each selected kind. */
  dungeonKinds: DungeonKind[];
};

export const DEFAULT_AVALON_FILTERS: AvalonFilters = { query: "", tiers: [], types: [], chestGrades: [], dungeonKinds: [] };

/**
 * Zone names are typed from memory or a screenshot ("ouyos aoeuam", "Ouyos-Aoeu"), so compare on
 * letters/digits only. English-style lowercasing keeps "I" → "i" (the Turkish locale would give "ı").
 */
export function normalizeZoneName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function matchesZoneQuery(zone: Pick<AvalonZone, "id" | "name">, query: string): boolean {
  const q = normalizeZoneName(query);
  if (!q) return true;
  return normalizeZoneName(zone.name).includes(q) || normalizeZoneName(zone.id).includes(q);
}

export function filterZones(zones: readonly AvalonZone[], f: AvalonFilters): AvalonZone[] {
  const q = normalizeZoneName(f.query);
  const out = zones.filter(
    (z) =>
      (f.tiers.length === 0 || f.tiers.includes(z.tier)) &&
      (f.types.length === 0 || f.types.includes(z.type)) &&
      f.chestGrades.every((g) => z.chests.some((c) => c.grade === g)) &&
      f.dungeonKinds.every((k) => z.dungeons.some((d) => d.kind === k)) &&
      (!q || matchesZoneQuery(z, q)),
  );
  if (!q) return out;
  // Names that start with the query first, then the rest alphabetically.
  return out.sort((a, b) => {
    const as = normalizeZoneName(a.name).startsWith(q) ? 0 : 1;
    const bs = normalizeZoneName(b.name).startsWith(q) ? 0 : 1;
    return as - bs || a.name.localeCompare(b.name);
  });
}

export function totalChests(zone: Pick<AvalonZone, "chests">): number {
  return zone.chests.reduce((s, c) => s + c.count, 0);
}

export function totalDungeons(zone: Pick<AvalonZone, "dungeons">): number {
  return zone.dungeons.reduce((s, d) => s + d.count, 0);
}
