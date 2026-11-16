import { fixedPoint, isIdTag, isObjectIdLike } from "./extract";
import type { PhotonMessage } from "./photon";

/**
 * TakeSilver (62), verified in a local capture (solo dungeon): sent to the player who picked up silver,
 * followed by UpdateMoney (81) with the new balance. Fixed-point amounts use a factor of 10,000.
 * Keys: 0 picker object id, 1 server tick, 2 silver object id, 3 yield before tax, 4 cluster tax,
 * 5 guild tax, 6 alliance penalty, 7 Premium bonus flag, 8 cluster multiplier (informational).
 * Live example: 3 = 58.7808, 5 = 2.9390 → 55.8418 received (UpdateMoney rose by exactly that).
 * https://github.com/Triky313/AlbionOnline-StatisticsAnalysis/blob/main/src/StatisticsAnalysisTool/Network/Events/TakeSilverEvent.cs
 * Event codes and layouts must be rechecked after game patches.
 */
const TAKE_SILVER_EVENT = 62;
const TAX_KEYS = [4, 5, 6] as const;

export function readSilverPickup(msg: PhotonMessage) {
  if (msg.kind !== "event" || msg.code !== TAKE_SILVER_EVENT) return null;
  const objectId = msg.params.get(0);
  if (!isObjectIdLike(objectId) || !isIdTag(msg.types.get(0))) return null;
  const preTax = fixedPoint(msg, 3);
  if (preTax === null || preTax <= 0) return null;
  let tax = 0;
  for (const k of TAX_KEYS) {
    if (!msg.params.has(k)) continue;
    const v = fixedPoint(msg, k);
    if (v === null) return null;
    tax += v;
  }
  const tick = msg.params.get(1);
  const target = msg.params.get(2);
  return {
    objectId,
    /** Same pickup seen twice (retransmission, calibration replay) has the same tick and silver object. */
    key: typeof tick === "number" && typeof target === "number" ? `${tick}:${target}` : null,
    preTax,
    tax: Math.min(tax, preTax),
    net: Math.max(0, preTax - tax),
  };
}
