import { getCatalogItemByIndex } from "@/lib/catalog/catalog";
import type { PhotonMessage } from "./photon";
import type { PhotonValue } from "./protocol18";
import type { MainHandObservation } from "./types";

/**
 * Layout verified against local captures and the current StatisticsAnalysisTool packet readers:
 * NewCharacter: equipment at key 40; CharacterEquipmentChanged (90): object id at 0, equipment at 2.
 * Main Hand is slot 0 in the ten-slot equipment array. Event numbers can change with game patches.
 * https://github.com/Triky313/AlbionOnline-StatisticsAnalysis/tree/main/src/StatisticsAnalysisTool/Network
 */
export const EQUIPMENT_CHANGED_EVENT = 90;

/** undefined: no usable equipment field; null: item index unknown (clear any previous weapon). */
export function readMainHand(msg: PhotonMessage, key: number): MainHandObservation | null | undefined {
  const value = msg.params.get(key);
  const tag = msg.types.get(key);
  if (tag !== "x" && tag !== "y:k" && tag !== "y:i") return undefined;
  if (!(Array.isArray(value) || value instanceof Uint8Array) || value.length !== 10) return undefined;
  if (!Array.from(value as ArrayLike<PhotonValue>).every((slot) => typeof slot === "number" && Number.isInteger(slot) && slot >= 0)) {
    return undefined;
  }
  const index = Number(value[0]);
  if (index === 0) return { item: null, observedAt: msg.at };
  const item = getCatalogItemByIndex(index);
  // Main Hand may also be a gathering tool. Never label unrelated item types as a weapon.
  if (!item || !/^T\d_(MAIN_|2H_)/.test(item.id) || (item.category !== "weapons" && item.category !== "gathering")) return null;
  return { item: { id: item.id, nameEn: item.nameEn, tier: item.tier, enchant: item.enchant }, observedAt: msg.at };
}
