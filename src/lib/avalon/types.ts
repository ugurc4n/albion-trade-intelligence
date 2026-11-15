/** Static Roads of Avalon zone layouts extracted from the game data dumps (scripts/build-avalon.ts). */

export type ChestSize = "small" | "medium" | "large";
export type ChestGrade = "standard" | "veteran" | "elite";
export type DungeonKind = "solo" | "group" | "avalonian";

export type AvalonChest = { size: ChestSize; grade: ChestGrade; tier: number; count: number };
export type AvalonDungeon = { kind: DungeonKind; tier: number; faction: string; count: number };
export type AvalonResource = { type: string; tier: number; count: number };

export type AvalonZone = {
  /** Cluster id, e.g. TNL-001. */
  id: string;
  /** In-game zone name, e.g. "Ouyos-Aoeuam". */
  name: string;
  /** Raw cluster type, e.g. TUNNEL_ROYAL, TUNNEL_BLACK_MEDIUM. */
  type: string;
  tier: number;
  chests: AvalonChest[];
  dungeons: AvalonDungeon[];
  /** Resource nodes (tier ≥ 4 only; lower tiers in the dump are editor placeholders). */
  resources: AvalonResource[];
};

export type AvalonDataFile = {
  generatedAt: string;
  source: string;
  zones: AvalonZone[];
};

export const CHEST_SIZE_LABELS: Record<ChestSize, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
};

export const CHEST_GRADE_LABELS: Record<ChestGrade, string> = {
  standard: "Standard",
  veteran: "Veteran",
  elite: "Elite",
};

export const DUNGEON_KIND_LABELS: Record<DungeonKind, string> = {
  solo: "Solo Dungeon",
  group: "Group Dungeon",
  avalonian: "Avalonian Dungeon (Elite)",
};

export const FACTION_LABELS: Record<string, string> = {
  KPR: "Keeper",
  HER: "Heretic",
  MOR: "Morgana",
  UND: "Undead",
  AVA: "Avalonian",
};

export const RESOURCE_LABELS: Record<string, string> = {
  WOOD: "Wood",
  ORE: "Ore",
  FIBER: "Fiber",
  HIDE: "Hide",
  ROCK: "Stone",
};

/** Literal readings of the raw cluster type codes — no claims beyond what the code itself says. */
export const ZONE_TYPE_LABELS: Record<string, string> = {
  TUNNEL_ROYAL: "Royal",
  TUNNEL_ROYAL_RED: "Royal (Red)",
  TUNNEL_LOW: "Low",
  TUNNEL_MEDIUM: "Medium",
  TUNNEL_HIGH: "High",
  TUNNEL_DEEP: "Deep",
  TUNNEL_DEEP_RAID: "Deep (Raid)",
  TUNNEL_BLACK_LOW: "Black · Low",
  TUNNEL_BLACK_MEDIUM: "Black · Medium",
  TUNNEL_BLACK_HIGH: "Black · High",
  TUNNEL_HIDEOUT: "Hideout",
  TUNNEL_HIDEOUT_DEEP: "Hideout (Deep)",
};

export function zoneTypeLabel(type: string): string {
  return ZONE_TYPE_LABELS[type] ?? type;
}
