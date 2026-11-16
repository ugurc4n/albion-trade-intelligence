import { getCatalogItem } from "@/lib/catalog/catalog";
import {
  EQUIPMENT_SLOTS,
  type EventPlayer,
  type GearItem,
  type KillEvent,
  type LifetimeStats,
  type PlayerProfile,
  type PlayerRef,
  type RawEvent,
  type RawPlayer,
} from "./types";

type RawItem = { Type: string; Count: number; Quality: number } | null | undefined;

function gear(item: RawItem): GearItem | null {
  if (!item || !item.Type) return null;
  return { type: item.Type, name: getCatalogItem(item.Type)?.nameEn ?? null, quality: item.Quality, count: Math.max(1, item.Count) };
}

function ref(p: RawPlayer): PlayerRef {
  return { id: p.Id, name: p.Name, guild: p.GuildName, alliance: p.AllianceName, itemPower: Math.round(p.AverageItemPower ?? 0) };
}

function eventPlayer(p: RawPlayer): EventPlayer {
  const equipment: EventPlayer["equipment"] = {};
  for (const slot of EQUIPMENT_SLOTS) {
    const g = gear(p.Equipment?.[slot]);
    if (g) equipment[slot] = g;
  }
  return { ...ref(p), equipment };
}

export function toKillEvent(e: RawEvent): KillEvent {
  return {
    id: e.EventId,
    at: e.TimeStamp,
    killer: eventPlayer(e.Killer),
    victim: { ...eventPlayer(e.Victim), inventory: (e.Victim.Inventory ?? []).map(gear).filter((g): g is GearItem => g !== null) },
    fame: e.TotalVictimKillFame,
    participants: e.Participants.map((p) => ({ ...ref(p), damage: p.DamageDone ?? 0, healing: p.SupportHealingDone ?? 0 })).sort(
      (a, b) => b.damage + b.healing - (a.damage + a.healing),
    ),
    partySize: Math.max(e.numberOfParticipants ?? 0, e.groupMemberCount ?? 0, e.Participants.length, 1),
    area: e.KillArea ?? null,
    value: null,
  };
}

export function toProfile(p: RawPlayer): PlayerProfile {
  const l = p.LifetimeStatistics;
  const lifetime: LifetimeStats | null = l
    ? {
        pve: {
          total: l.PvE?.Total ?? 0,
          royal: l.PvE?.Royal ?? 0,
          outlands: l.PvE?.Outlands ?? 0,
          avalon: l.PvE?.Avalon ?? 0,
          hellgate: l.PvE?.Hellgate ?? 0,
          corruptedDungeon: l.PvE?.CorruptedDungeon ?? 0,
          mists: l.PvE?.Mists ?? 0,
        },
        gathering: {
          fiber: l.Gathering?.Fiber?.Total ?? 0,
          hide: l.Gathering?.Hide?.Total ?? 0,
          ore: l.Gathering?.Ore?.Total ?? 0,
          rock: l.Gathering?.Rock?.Total ?? 0,
          wood: l.Gathering?.Wood?.Total ?? 0,
          total: l.Gathering?.All?.Total ?? 0,
        },
        crafting: l.Crafting?.Total ?? 0,
        crystalLeague: l.CrystalLeague ?? 0,
        fishing: l.FishingFame ?? 0,
        farming: l.FarmingFame ?? 0,
      }
    : null;
  return {
    id: p.Id,
    name: p.Name,
    guild: p.GuildName,
    alliance: p.AllianceName,
    allianceTag: p.AllianceTag,
    killFame: p.KillFame,
    deathFame: p.DeathFame,
    fameRatio: p.FameRatio,
    lifetime,
  };
}

/** Non-tradable items (silver bags, tomes) and quality-less entries have no market price. */
export function isPriceable(item: GearItem): boolean {
  return !item.type.includes("NONTRADABLE") && !item.type.includes("_SILVERBAG");
}

/** Every item a list of events could need a price for: the victim's equipment and inventory. */
export function itemsToPrice(events: readonly KillEvent[]): GearItem[] {
  return events.flatMap((e) => [...Object.values(e.victim.equipment), ...e.victim.inventory]).filter(isPriceable);
}

/**
 * Estimated value of what the victim lost. `price` returns one unit's value for an item and Quality, or
 * null when it is unknown; such items are counted in `unpriced` instead of being guessed.
 */
export function valueEvent(e: KillEvent, price: (type: string, quality: number) => number | null): KillEvent["value"] {
  let unpriced = 0;
  const sum = (items: GearItem[]) => {
    let total: number | null = null;
    for (const item of items) {
      if (!isPriceable(item)) continue;
      const unit = price(item.type, item.quality);
      if (unit === null) {
        unpriced++;
        continue;
      }
      total = (total ?? 0) + unit * item.count;
    }
    return total;
  };
  return { equipment: sum(Object.values(e.victim.equipment)), inventory: sum(e.victim.inventory), unpriced };
}
