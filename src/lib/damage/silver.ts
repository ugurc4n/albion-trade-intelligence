import { fixedPoint } from "./extract";
import type { PhotonMessage } from "./photon";

/**
 * Silver share (278, "OtherGrabbedLoot" with the silver flag), verified in local captures: one message per
 * player who received silver. Solo, every pickup is yours; in a party a pickup is split and each member gets
 * their own message with their name and share, after tax.
 * Keys: 0 the picker's object id (not the receiver), 2 the receiver's name, 3 silver flag, 5 amount (×10,000).
 * Live party capture: the shares named "pesimist" added up to the UpdateMoney balance increase (54,327 vs
 * 54,045 over 10 minutes), while the TakeSilver events for your own id covered only your own pickups (4,483).
 * https://github.com/Triky313/AlbionOnline-StatisticsAnalysis/blob/main/src/StatisticsAnalysisTool/Network/Events/GrabbedLootEvent.cs
 * Event codes and layouts must be rechecked after game patches.
 */
const SILVER_SHARE_EVENT = 278;

export type SilverShare = { name: string; amount: number; picker: unknown };

export function readSilverShare(msg: PhotonMessage): SilverShare | null {
  if (msg.kind !== "event" || msg.code !== SILVER_SHARE_EVENT || msg.params.get(3) !== true) return null;
  const name = msg.params.get(2);
  const amount = fixedPoint(msg, 5);
  if (typeof name !== "string" || name.length === 0 || amount === null || amount <= 0) return null;
  return { name, amount, picker: msg.params.get(0) ?? null };
}
