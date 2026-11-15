import { isIdTag, isObjectIdLike } from "./extract";
import type { PhotonMessage } from "./photon";

/**
 * UpdateFame (82), verified in local captures. Fixed-point values use a factor of 10,000.
 * Layout and bonus calculation:
 * https://github.com/Triky313/AlbionOnline-StatisticsAnalysis/blob/main/src/StatisticsAnalysisTool/Network/Events/UpdateFameEvent.cs
 * Optional Premium/Satchel fields default to false/zero. Modifier 17 is informational:
 * it is already reflected in the reward and must not be applied twice.
 * Event codes and layouts must be rechecked after game patches.
 */
const UPDATE_FAME_EVENT = 82;
const FIXED_POINT_FACTOR = 10_000;

function fixedPoint(msg: PhotonMessage, key: number): number | null {
  const value = msg.params.get(key);
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && isIdTag(msg.types.get(key))
    ? value / FIXED_POINT_FACTOR
    : null;
}

export function readFameReward(msg: PhotonMessage) {
  if (msg.kind !== "event" || msg.code !== UPDATE_FAME_EVENT) return null;
  const objectId = msg.params.get(0);
  if (!isObjectIdLike(objectId) || !isIdTag(msg.types.get(0))) return null;
  const cumulative = fixedPoint(msg, 1);
  const zoneIncluded = fixedPoint(msg, 2);
  // Crafting uses an array in key 10: do not count it as a scalar combat reward.
  const satchel = msg.params.has(10) ? fixedPoint(msg, 10) : 0;
  const premiumFlag = msg.params.get(5);
  if (cumulative === null || zoneIncluded === null || satchel === null) return null;
  if (premiumFlag !== undefined && (typeof premiumFlag !== "boolean" || msg.types.get(5) !== "o")) return null;
  const premium = premiumFlag === true ? zoneIncluded * 0.5 : 0;
  const total = zoneIncluded + premium + satchel;
  if (total <= 0) return null;
  const modifier = msg.params.get(17);
  const lastBonusPercent = typeof modifier === "number" && Number.isFinite(modifier) && modifier >= 0 &&
    (msg.types.get(17) === "f" || msg.types.get(17) === "d") ? modifier * 100 : null;
  return { objectId, cumulative, zoneIncluded, premium, satchel, total, lastBonusPercent };
}
