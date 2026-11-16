/**
 * Server-only access to Albion Online's public killboard API (gameinfo), cached per Node process.
 * Never import this from client components.
 */
import { z } from "zod";
import { TtlCache } from "@/lib/albion/cache";
import { AlbionApiError } from "@/lib/albion/client";
import type { ServerId } from "@/lib/albion/constants";
import { getItemValues } from "@/lib/market/service";
import { itemsToPrice, toKillEvent, toProfile, valueEvent } from "./parse";
import { rawEventSchema, rawPlayerSchema, searchResponseSchema, type KillEvent, type PlayerResponse, type PlayerSummary } from "./types";

/** Each game server has its own killboard host. */
const HOSTS: Record<ServerId, string> = {
  europe: "https://gameinfo-ams.albiononline.com",
  west: "https://gameinfo.albiononline.com",
  east: "https://gameinfo-sgp.albiononline.com",
};

const TIMEOUT_MS = 20_000;
const SEARCH_TTL_MS = 10 * 60_000;
const PLAYER_TTL_MS = 2 * 60_000;
/** Player ids are short base64-like strings. */
const PLAYER_ID = /^[A-Za-z0-9_-]{10,40}$/;
const LIST_LIMIT = 50;

const g = globalThis as unknown as { __killboardCache?: TtlCache };
const cache = () => (g.__killboardCache ??= new TtlCache(500));

export function isValidPlayerId(id: string): boolean {
  return PLAYER_ID.test(id);
}

async function getJson(server: ServerId, path: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${HOSTS[server]}/api/gameinfo${path}`, {
      headers: { Accept: "application/json", "Accept-Encoding": "gzip, deflate, br", "User-Agent": "albion-trade-intelligence/0.1 (player lookup)" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new AlbionApiError(timeout ? "timeout" : "network", timeout ? "The Albion killboard timed out." : `Could not reach the Albion killboard: ${(err as Error).message}`);
  }
  if (res.status === 404) throw new AlbionApiError("http", "Player not found on the killboard.", 404);
  if (res.status === 429) throw new AlbionApiError("rate_limited", "The Albion killboard is rate limiting requests. Try again in a minute.", 429, Date.now() + 60_000);
  if (!res.ok) throw new AlbionApiError("http", `The Albion killboard returned HTTP ${res.status}.`, res.status);
  try {
    return await res.json();
  } catch {
    throw new AlbionApiError("invalid_response", "The Albion killboard response is not JSON.");
  }
}

function parse<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new AlbionApiError("invalid_response", `Unexpected killboard response for ${what}.`);
  return r.data;
}

/** Events are parsed one by one so a single odd entry does not hide the rest. */
function parseEvents(body: unknown): KillEvent[] {
  if (!Array.isArray(body)) throw new AlbionApiError("invalid_response", "Unexpected killboard response for events.");
  return body.flatMap((e) => {
    const r = rawEventSchema.safeParse(e);
    return r.success ? [toKillEvent(r.data)] : [];
  });
}

export async function searchPlayers(server: ServerId, query: string): Promise<PlayerSummary[]> {
  const q = query.trim();
  const { value } = await cache().get(`search:${server}:${q.toLowerCase()}`, SEARCH_TTL_MS, async () => {
    const body = parse(searchResponseSchema, await getJson(server, `/search?q=${encodeURIComponent(q)}`), "search");
    return body.players.map((p) => ({
      id: p.Id,
      name: p.Name,
      guild: p.GuildName,
      alliance: p.AllianceName,
      killFame: p.KillFame,
      deathFame: p.DeathFame,
    }));
  });
  // Exact name first, then by PvP activity.
  const lower = q.toLowerCase();
  return [...value].sort(
    (a, b) => Number(b.name.toLowerCase() === lower) - Number(a.name.toLowerCase() === lower) || b.killFame + b.deathFame - (a.killFame + a.deathFame),
  );
}

/** Profile, recent kills and deaths, and this week's top kills, with the victims' losses valued at market prices. */
export async function getPlayer(server: ServerId, id: string): Promise<PlayerResponse> {
  const { value, fetchedAt } = await cache().get(`player:${server}:${id}`, PLAYER_TTL_MS, async () => {
    const [profile, kills, deaths, top] = await Promise.allSettled([
      getJson(server, `/players/${id}`),
      getJson(server, `/players/${id}/kills?limit=${LIST_LIMIT}&offset=0`),
      getJson(server, `/players/${id}/deaths?limit=${LIST_LIMIT}&offset=0`),
      getJson(server, `/players/${id}/topkills?range=week&limit=10&offset=0`),
    ]);
    if (profile.status === "rejected") throw profile.reason;
    const warnings: string[] = [];
    const list = (r: PromiseSettledResult<unknown>, what: string) => {
      if (r.status === "fulfilled") {
        try {
          return parseEvents(r.value);
        } catch (err) {
          warnings.push(`${what}: ${(err as Error).message}`);
          return [];
        }
      }
      warnings.push(`${what}: ${(r.reason as Error).message}`);
      return [];
    };
    return {
      player: toProfile(parse(rawPlayerSchema, profile.value, "player")),
      kills: list(kills, "Kills"),
      deaths: list(deaths, "Deaths"),
      topKills: list(top, "Top kills"),
      warnings,
    };
  });

  // Values come from the market cache (refreshed on its own schedule), so they are added after the killboard cache.
  const all = [...value.kills, ...value.deaths, ...value.topKills];
  const warnings = [...value.warnings];
  let price: ((type: string, quality: number) => number | null) | null = null;
  try {
    price = await getItemValues(server, itemsToPrice(all).map((i) => i.type));
  } catch (err) {
    warnings.push(`Item values: ${(err as Error).message}`);
  }
  const valued = (events: KillEvent[]) => events.map((e) => ({ ...e, value: price ? valueEvent(e, price) : null }));
  return {
    server,
    player: value.player,
    kills: valued(value.kills),
    deaths: valued(value.deaths),
    topKills: valued(value.topKills),
    warnings,
    fetchedAt,
  };
}
