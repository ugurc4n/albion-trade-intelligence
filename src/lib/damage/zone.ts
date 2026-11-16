import { fixedPoint, isIdTag, isObjectIdLike } from "./extract";
import type { PhotonMessage } from "./photon";

/**
 * Zone and silver balance, verified in a local capture (open world → random dungeon → open world):
 *   join reply (response 2): 0 your object id, 8 zone id ("3207", "@RANDOMDUNGEON@<guid>"), 33 balance
 *   UpdateMoney (event 81):  0 your object id, 1 new balance
 * Balances are fixed-point (×10,000). Codes and keys must be rechecked after game patches.
 */
const JOIN_RESPONSE = 2;
const JOIN_ZONE_KEY = 8;
const JOIN_BALANCE_KEY = 33;
const UPDATE_MONEY_EVENT = 81;

export function readJoinZone(msg: PhotonMessage): { zone: string; balance: number | null } | null {
  if (msg.kind !== "response" || msg.code !== JOIN_RESPONSE) return null;
  const zone = msg.params.get(JOIN_ZONE_KEY);
  if (typeof zone !== "string" || zone.length === 0 || msg.types.get(JOIN_ZONE_KEY) !== "s") return null;
  return { zone, balance: fixedPoint(msg, JOIN_BALANCE_KEY) };
}

export function readBalanceUpdate(msg: PhotonMessage): { objectId: number; balance: number } | null {
  if (msg.kind !== "event" || msg.code !== UPDATE_MONEY_EVENT) return null;
  const objectId = msg.params.get(0);
  const balance = fixedPoint(msg, 1);
  if (!isObjectIdLike(objectId) || !isIdTag(msg.types.get(0)) || balance === null) return null;
  return { objectId, balance };
}

/** Instance zones carry their kind as a prefix: "@RANDOMDUNGEON@<guid>" → "Random Dungeon". */
const INSTANCE_NAMES: Record<string, string> = {
  RANDOMDUNGEON: "Random Dungeon",
  DRAGONAREA: "Dragon Area",
  CORRUPTEDDUNGEON: "Corrupted Dungeon",
  HELLGATE: "Hellgate",
  HELLDUNGEON: "Hell Dungeon",
  EXPEDITION: "Expedition",
  ARENA: "Arena",
  MISTS: "Mists",
};

export function zoneLabel(zone: string | null): string {
  if (!zone) return "Bilinmeyen bölge";
  const instance = zone.match(/^@([A-Z_]+)@/);
  if (instance) {
    const kind = instance[1];
    return INSTANCE_NAMES[kind] ?? kind.charAt(0) + kind.slice(1).toLowerCase().replace(/_/g, " ");
  }
  return `Bölge ${zone}`;
}
