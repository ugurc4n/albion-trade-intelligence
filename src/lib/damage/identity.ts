import { isIdTag, isObjectIdLike } from "./extract";
import type { PhotonMessage } from "./photon";
import type { HealthRule } from "./types";

/**
 * Who is who. Names come only from the two messages that announce a character, both verified in live captures:
 *   join reply (response 2): your object id at 0, your name at 2 (sent on every zone change)
 *   NewCharacter (event 29): a character's object id at 0, name at 1 (sent when they come into view)
 * Other messages that carry names next to object ids (KnockedDown, Died, loot) pair an id with someone else's
 * name — the killer, the picker, a party member — and learning from them merged and swapped players.
 * Event codes and keys must be rechecked after game patches.
 */
export const JOIN_RESPONSE = 2;
export const NEW_CHARACTER_EVENT = 29;

/**
 * HealthUpdate (6): target 0, change 2 (negative = damage), remaining health 3, causer 6; HealthUpdates (7) is
 * the batched form. Verified in solo and party captures. Calibration only replaces it when a patch moves it.
 */
export const DEFAULT_HEALTH_RULE: HealthRule = { signature: "event:6", causerKey: 6, changeKey: 2, targetKey: 0 };

/** Albion character names: 3–16 letters/digits with at least one letter. */
const CHARACTER_NAME = /^(?=.*[A-Za-z])[A-Za-z0-9]{3,16}$/;
const NOT_NAMES = new Set(["system", "true", "false", "null"]);

export function looksLikeCharacterName(v: string): boolean {
  return CHARACTER_NAME.test(v) && !NOT_NAMES.has(v.toLowerCase());
}

function read(msg: PhotonMessage, idKey: number, nameKey: number): { id: number; name: string } | null {
  const id = msg.params.get(idKey);
  const name = msg.params.get(nameKey);
  if (!isObjectIdLike(id) || !isIdTag(msg.types.get(idKey)) || typeof name !== "string" || !looksLikeCharacterName(name)) return null;
  return { id, name };
}

/** Your own character from the join reply. */
export function readJoin(msg: PhotonMessage): { id: number; name: string } | null {
  return msg.kind === "response" && msg.code === JOIN_RESPONSE ? read(msg, 0, 2) : null;
}

/** Another character coming into view. */
export function readNewCharacter(msg: PhotonMessage): { id: number; name: string } | null {
  return msg.kind === "event" && msg.code === NEW_CHARACTER_EVENT ? read(msg, 0, 1) : null;
}
