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
  small: "Küçük",
  medium: "Orta",
  large: "Büyük",
};

export const CHEST_GRADE_LABELS: Record<ChestGrade, string> = {
  standard: "Standart",
  veteran: "Veteran",
  elite: "Elit",
};

export const DUNGEON_KIND_LABELS: Record<DungeonKind, string> = {
  solo: "Solo zindan",
  group: "Grup zindanı",
  avalonian: "Avalon zindanı (elit)",
};

export const FACTION_LABELS: Record<string, string> = {
  KPR: "Keeper",
  HER: "Heretic",
  MOR: "Morgana",
  UND: "Undead",
  AVA: "Avalon",
};

export const RESOURCE_LABELS: Record<string, string> = {
  WOOD: "Odun",
  ORE: "Maden",
  FIBER: "Lif",
  HIDE: "Deri",
  ROCK: "Taş",
};

/** Literal readings of the raw cluster type codes — no claims beyond what the code itself says. */
export const ZONE_TYPE_LABELS: Record<string, string> = {
  TUNNEL_ROYAL: "Royal",
  TUNNEL_ROYAL_RED: "Royal (kırmızı)",
  TUNNEL_LOW: "Düşük",
  TUNNEL_MEDIUM: "Orta",
  TUNNEL_HIGH: "Yüksek",
  TUNNEL_DEEP: "Derin",
  TUNNEL_DEEP_RAID: "Derin (raid)",
  TUNNEL_BLACK_LOW: "Black · düşük",
  TUNNEL_BLACK_MEDIUM: "Black · orta",
  TUNNEL_BLACK_HIGH: "Black · yüksek",
  TUNNEL_HIDEOUT: "Hideout",
  TUNNEL_HIDEOUT_DEEP: "Hideout (derin)",
};

export function zoneTypeLabel(type: string): string {
  return ZONE_TYPE_LABELS[type] ?? type;
}
