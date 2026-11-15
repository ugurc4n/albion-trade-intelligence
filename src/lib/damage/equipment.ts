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
  return mainHandFromIndex(Number(value[0]), msg.at);
}

/** Item index (0 = empty slot) → Main Hand observation; null when the index is not a known weapon/tool. */
export function mainHandFromIndex(index: number, at: number): MainHandObservation | null {
  if (index === 0) return { item: null, observedAt: at };
  const item = getCatalogItemByIndex(index);
  // Main Hand may also be a gathering tool. Never label unrelated item types as a weapon.
  if (!item || !/^T\d_(MAIN_|2H_)/.test(item.id) || (item.category !== "weapons" && item.category !== "gathering")) return null;
  return { item: { id: item.id, nameEn: item.nameEn, tier: item.tier, enchant: item.enchant }, observedAt: at };
}

/**
 * Own character: the join reply (response 2) does not carry item indices for you. Key 52 lists the
 * object ids of your equipped items (slot 0 = Main Hand), and each item object is announced right
 * after it by NewEquipmentItem (event 30): object id at 0, item index at 1. Verified in local captures.
 */
export const NEW_EQUIPMENT_ITEM_EVENT = 30;
export const JOIN_EQUIPMENT_KEY = 52;

/** Object ids of your equipped items from the join reply (ten slots), or null. */
export function readJoinEquipment(msg: PhotonMessage): number[] | null {
  const value = msg.params.get(JOIN_EQUIPMENT_KEY);
  const tag = msg.types.get(JOIN_EQUIPMENT_KEY);
  if ((tag !== "y:i" && tag !== "y:l") || !Array.isArray(value) || value.length !== 10) return null;
  return value.every((v) => typeof v === "number" && Number.isInteger(v) && v >= 0) ? (value as number[]) : null;
}

/** NewEquipmentItem (event 30): item object id → item index. */
export function readEquipmentItem(msg: PhotonMessage): { objectId: number; index: number } | null {
  if (msg.kind !== "event" || msg.code !== NEW_EQUIPMENT_ITEM_EVENT) return null;
  const objectId = msg.params.get(0);
  const index = msg.params.get(1);
  const indexTag = msg.types.get(1);
  if (typeof objectId !== "number" || !Number.isInteger(objectId) || objectId <= 0 || msg.types.get(0) !== "l") return null;
  if (typeof index !== "number" || !Number.isInteger(index) || index <= 0 || (indexTag !== "k" && indexTag !== "i")) return null;
  return { objectId, index };
}
