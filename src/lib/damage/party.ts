import type { PhotonMessage } from "./photon";
import type { PhotonValue } from "./protocol18";

/**
 * Party membership by user id (a 16-byte GUID that stays the same across zones, unlike object ids).
 * Verified in a live party capture: on every zone entry the game sends PartyOnClusterPartyJoined (242) with the
 * GUIDs of all party members at key 0, and the 5 GUIDs matched exactly the 5 party members' NewCharacter
 * (key 7) and join reply (key 1) GUIDs; the three other players in the dungeon were not in it.
 * PartyJoined (230: GUIDs at 8 or 5, names at 9 or 6), PartyPlayerJoined (232: GUID 1, name 2),
 * PartyPlayerLeft (234: GUID 1) and PartyDisbanded (231) follow the AFM Data Client's current packet readers
 * (github.com/JPCodeCraft/AFMDataClientCore); not yet seen in our own captures.
 */
export const PARTY_ON_CLUSTER_EVENT = 242;
const PARTY_JOINED_EVENT = 230;
const PARTY_DISBANDED_EVENT = 231;
const PARTY_PLAYER_JOINED_EVENT = 232;
const PARTY_PLAYER_LEFT_EVENT = 234;
/** User GUID in the join reply and in NewCharacter. */
export const JOIN_GUID_KEY = 1;
export const NEW_CHARACTER_GUID_KEY = 7;

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** One GUID as hex, or null. */
export function guidOf(value: PhotonValue | undefined): string | null {
  return value instanceof Uint8Array && value.length === 16 ? hex(value) : null;
}

/** A list of GUIDs: either 16-byte chunks of one byte array (242) or an array of 16-byte arrays. */
function guidList(value: PhotonValue | undefined): string[] | null {
  if (value instanceof Uint8Array) {
    if (value.length === 0 || value.length % 16 !== 0) return null;
    return Array.from({ length: value.length / 16 }, (_, i) => hex(value.subarray(i * 16, i * 16 + 16)));
  }
  if (Array.isArray(value)) {
    const guids = value.map(guidOf);
    return guids.every((g): g is string => g !== null) ? guids : null;
  }
  return null;
}

export type PartyUpdate =
  /** The whole roster (zone entry or joining a party); names when the message carries them. */
  | { kind: "roster"; guids: string[]; names: Map<string, string> }
  | { kind: "joined"; guid: string; name: string | null }
  | { kind: "left"; guid: string }
  | { kind: "disbanded" };

export function readPartyUpdate(msg: PhotonMessage): PartyUpdate | null {
  if (msg.kind !== "event") return null;
  switch (msg.code) {
    case PARTY_ON_CLUSTER_EVENT: {
      const guids = guidList(msg.params.get(0));
      return guids ? { kind: "roster", guids, names: new Map() } : null;
    }
    case PARTY_JOINED_EVENT: {
      for (const [guidKey, nameKey] of [[8, 9], [5, 6]] as const) {
        const guids = guidList(msg.params.get(guidKey));
        const names = msg.params.get(nameKey);
        if (!guids || !Array.isArray(names)) continue;
        const byGuid = new Map<string, string>();
        guids.forEach((g, i) => {
          const n = names[i];
          if (typeof n === "string" && n.length > 0) byGuid.set(g, n);
        });
        return { kind: "roster", guids, names: byGuid };
      }
      return null;
    }
    case PARTY_PLAYER_JOINED_EVENT: {
      const guid = guidOf(msg.params.get(1));
      const name = msg.params.get(2);
      return guid ? { kind: "joined", guid, name: typeof name === "string" && name.length > 0 ? name : null } : null;
    }
    case PARTY_PLAYER_LEFT_EVENT: {
      const guid = guidOf(msg.params.get(1));
      return guid ? { kind: "left", guid } : null;
    }
    case PARTY_DISBANDED_EVENT:
      return { kind: "disbanded" };
    default:
      return null;
  }
}
