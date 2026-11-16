/**
 * Albion Online's public killboard API (gameinfo): player search, profiles with lifetime statistics, and
 * PvP kill/death events. Responses are large and loosely typed, so they are parsed leniently and trimmed
 * to what the Player Lookup screen shows. Field names verified against live responses (Europe).
 */
import { z } from "zod";

const num = z.number().catch(0);
const str = z.string().nullish().transform((v) => v ?? "");

const itemSchema = z
  .object({ Type: z.string(), Count: num, Quality: num })
  .nullish()
  .catch(null);

const EQUIPMENT_SLOTS = ["MainHand", "OffHand", "Head", "Armor", "Shoes", "Bag", "Cape", "Mount", "Potion", "Food"] as const;
export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];

const equipmentSchema = z
  .object(Object.fromEntries(EQUIPMENT_SLOTS.map((s) => [s, itemSchema])) as Record<EquipmentSlot, typeof itemSchema>)
  .partial()
  .nullish()
  .catch(null);

const regionSplit = z.object({ Total: num, Royal: num, Outlands: num, Avalon: num }).partial().catch({});

const lifetimeSchema = z
  .object({
    PvE: z.object({ Total: num, Royal: num, Outlands: num, Avalon: num, Hellgate: num, CorruptedDungeon: num, Mists: num }).partial().catch({}),
    Gathering: z
      .object({ Fiber: regionSplit, Hide: regionSplit, Ore: regionSplit, Rock: regionSplit, Wood: regionSplit, All: regionSplit })
      .partial()
      .catch({}),
    Crafting: regionSplit,
    CrystalLeague: num,
    FishingFame: num,
    FarmingFame: num,
  })
  .partial()
  .nullish()
  .catch(null);

export const rawPlayerSchema = z.object({
  Id: z.string(),
  Name: z.string(),
  GuildName: str,
  GuildId: str,
  AllianceName: str,
  AllianceId: str,
  AllianceTag: str,
  KillFame: num,
  DeathFame: num,
  FameRatio: num,
  AverageItemPower: num.optional(),
  Equipment: equipmentSchema.optional(),
  Inventory: z.array(itemSchema).nullish().catch(null),
  LifetimeStatistics: lifetimeSchema.optional(),
  DamageDone: num.optional(),
  SupportHealingDone: num.optional(),
});

export const searchResponseSchema = z.object({ players: z.array(rawPlayerSchema.pick({ Id: true, Name: true, GuildName: true, AllianceName: true, KillFame: true, DeathFame: true })).catch([]) });

export const rawEventSchema = z.object({
  EventId: z.number(),
  TimeStamp: z.string(),
  Killer: rawPlayerSchema,
  Victim: rawPlayerSchema,
  TotalVictimKillFame: num,
  Participants: z.array(rawPlayerSchema).catch([]),
  numberOfParticipants: num.optional(),
  groupMemberCount: num.optional(),
  KillArea: z.string().nullish(),
});

export type RawPlayer = z.infer<typeof rawPlayerSchema>;
export type RawEvent = z.infer<typeof rawEventSchema>;

/* ---------- trimmed shapes sent to the browser ---------- */

/** `name` is the catalog's English name, or null for items the catalog does not know (e.g. tomes, silver bags). */
export type GearItem = { type: string; name: string | null; quality: number; count: number };

export type PlayerRef = {
  id: string;
  name: string;
  guild: string;
  alliance: string;
  itemPower: number;
};

export type EventPlayer = PlayerRef & { equipment: Partial<Record<EquipmentSlot, GearItem>> };

export type KillEvent = {
  id: number;
  at: string;
  killer: EventPlayer;
  victim: EventPlayer & { inventory: GearItem[] };
  fame: number;
  /** Players who dealt damage or healed, with their share. */
  participants: (PlayerRef & { damage: number; healing: number })[];
  partySize: number;
  area: string | null;
  /** Estimated market value (silver) of the victim's equipment and inventory; null when no price was found. */
  value: { equipment: number | null; inventory: number | null; unpriced: number } | null;
};

export type PlayerSummary = { id: string; name: string; guild: string; alliance: string; killFame: number; deathFame: number };

export type LifetimeStats = {
  pve: { total: number; royal: number; outlands: number; avalon: number; hellgate: number; corruptedDungeon: number; mists: number };
  gathering: { fiber: number; hide: number; ore: number; rock: number; wood: number; total: number };
  crafting: number;
  crystalLeague: number;
  fishing: number;
  farming: number;
};

export type PlayerProfile = PlayerSummary & { allianceTag: string; fameRatio: number; lifetime: LifetimeStats | null };

export type PlayerResponse = {
  server: string;
  player: PlayerProfile;
  kills: KillEvent[];
  deaths: KillEvent[];
  topKills: KillEvent[];
  /** Errors from optional parts (lists or prices) that did not load; the rest is still shown. */
  warnings: string[];
  fetchedAt: number;
};

export { EQUIPMENT_SLOTS };
