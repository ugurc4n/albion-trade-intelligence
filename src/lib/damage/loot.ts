import { getCatalogItemByIndex } from "@/lib/catalog/catalog";
import type { PhotonMessage } from "./photon";
import type { LootEntry } from "./types";

/**
 * Item loot (278, "OtherGrabbedLoot" without the silver flag), verified in a local party capture: one message
 * per item someone picked up. Keys: 1 what it was looted from (a mob's unique name such as
 * "@MOB_UNDEAD_SOLDIER_CHAMPION", or a player's name for a corpse), 2 the looter's name, 4 the item index,
 * 5 the quantity. Silver shares use the same event with key 3 = true (see silver.ts).
 * https://github.com/Triky313/AlbionOnline-StatisticsAnalysis/blob/main/src/StatisticsAnalysisTool/Network/Events/GrabbedLootEvent.cs
 * Event codes and layouts must be rechecked after game patches.
 */
const GRABBED_LOOT_EVENT = 278;

export function readItemLoot(msg: PhotonMessage): Omit<LootEntry, "item"> | null {
  if (msg.kind !== "event" || msg.code !== GRABBED_LOOT_EVENT || msg.params.get(3) === true) return null;
  const by = msg.params.get(2);
  const from = msg.params.get(1);
  const index = msg.params.get(4);
  const quantity = msg.params.get(5);
  if (typeof by !== "string" || by.length === 0) return null;
  if (typeof index !== "number" || !Number.isInteger(index) || index <= 0) return null;
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity <= 0 || quantity > 100_000) return null;
  return { at: msg.at, by, from: typeof from === "string" ? from : "", index, quantity };
}

/** Catalog item for an item index; null when the catalog does not know it. */
export function lootItem(index: number): LootEntry["item"] {
  const item = getCatalogItemByIndex(index);
  return item ? { id: item.id, nameEn: item.nameEn, tier: item.tier, enchant: item.enchant } : null;
}
