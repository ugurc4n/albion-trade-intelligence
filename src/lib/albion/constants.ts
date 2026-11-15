export const SERVERS = {
  europe: { label: "Europe", host: "https://europe.albion-online-data.com" },
  west: { label: "Americas (West)", host: "https://west.albion-online-data.com" },
  east: { label: "Asia (East)", host: "https://east.albion-online-data.com" },
} as const;

export type ServerId = keyof typeof SERVERS;
export const SERVER_IDS = Object.keys(SERVERS) as ServerId[];

/**
 * Royal cities connected by blue/yellow zones. Caerleon (red zone city), Brecilien (Roads/Mists)
 * and the Black Market are deliberately excluded from safe-route trading.
 */
export const ROYAL_CITIES = ["Martlock", "Lymhurst", "Bridgewatch", "Fort Sterling", "Thetford"] as const;
export type City = (typeof ROYAL_CITIES)[number];

const CITY_LOOKUP = new Map<string, City>(
  ROYAL_CITIES.map((c) => [c.toLowerCase().replace(/\s+/g, ""), c]),
);

/** Maps an API location string ("Fort Sterling", "fortsterling") to a royal city, or null for any other location. */
export function toRoyalCity(location: string): City | null {
  return CITY_LOOKUP.get(location.toLowerCase().replace(/\s+/g, "")) ?? null;
}

export const QUALITY_LABELS: Record<number, string> = {
  1: "Normal",
  2: "Good",
  3: "Outstanding",
  4: "Excellent",
  5: "Masterpiece",
};

/** Rate limits published at /api/v2/swagger_doc: 100 req/min and 300 req/5 min per IP. We keep a safety margin. */
export const RATE_LIMITS = {
  perMinute: 90,
  perFiveMinutes: 270,
  maxConcurrent: 3,
} as const;

/** The API rejects URLs over 4096 characters; stay well below. */
export const MAX_URL_LENGTH = 3900;

export const CACHE_TTL = {
  pricesMs: 5 * 60_000,
  historyMs: 60 * 60_000,
  itemDetailMs: 3 * 60_000,
  orderbookMs: 2 * 60_000,
} as const;

export const ICON_URL = (itemId: string, quality = 1, size = 64) =>
  `https://render.albiononline.com/v1/item/${encodeURIComponent(itemId)}.png?quality=${quality}&size=${size}`;
