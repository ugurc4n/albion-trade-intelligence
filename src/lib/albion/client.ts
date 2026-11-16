import { z } from "zod";
import { MAX_URL_LENGTH, RATE_LIMITS, SERVERS, type ServerId } from "./constants";
import { RateLimiter } from "./rate-limiter";
import {
  historySeriesSchema,
  orderbookEntrySchema,
  parseRows,
  priceRowSchema,
  type HistorySeries,
  type OrderbookEntry,
  type PriceRow,
} from "./schemas";
import { isValidItemId } from "./batching";

export type ApiErrorKind = "rate_limited" | "network" | "timeout" | "http" | "invalid_response";

export class AlbionApiError extends Error {
  constructor(
    public readonly kind: ApiErrorKind,
    message: string,
    public readonly status?: number,
    /** Epoch ms after which a retry is allowed (rate limiting). */
    public readonly retryAt?: number,
  ) {
    super(message);
    this.name = "AlbionApiError";
  }
}

const REQUEST_TIMEOUT_MS = 20_000;
/** If the API asks us to wait at most this long, wait and retry once instead of failing. */
const MAX_INLINE_RETRY_WAIT_MS = 15_000;
const DEFAULT_429_BACKOFF_MS = 60_000;

type FetchFn = typeof fetch;

export type AlbionClientOptions = {
  limiter?: RateLimiter;
  fetchFn?: FetchFn;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type FetchResult<T> = { rows: T[]; invalidRows: number; url: string };

export class AlbionClient {
  readonly limiter: RateLimiter;
  private readonly fetchFn: FetchFn;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  lastError: { message: string; at: number } | null = null;

  constructor(options: AlbionClientOptions = {}) {
    this.limiter =
      options.limiter ??
      new RateLimiter({
        windows: [
          { limit: RATE_LIMITS.perMinute, intervalMs: 60_000 },
          { limit: RATE_LIMITS.perFiveMinutes, intervalMs: 5 * 60_000 },
        ],
        maxConcurrent: RATE_LIMITS.maxConcurrent,
      });
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  static buildUrl(
    server: ServerId,
    endpoint: "prices" | "history" | "orderbook",
    ids: string[],
    params: Record<string, string | undefined>,
  ): string {
    for (const id of ids) {
      if (!isValidItemId(id)) throw new AlbionApiError("invalid_response", `Invalid item id: ${id}`);
    }
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") search.set(k, v);
    const qs = search.toString();
    return `${SERVERS[server].host}/api/v2/stats/${endpoint}/${ids.join(",")}.json${qs ? `?${qs}` : ""}`;
  }

  async getPrices(server: ServerId, ids: string[], locations: readonly string[], qualities?: number[]) {
    const url = AlbionClient.buildUrl(server, "prices", ids, {
      locations: locations.join(","),
      qualities: qualities?.join(","),
    });
    return this.fetchRows<PriceRow>(url, priceRowSchema);
  }

  async getHistory(
    server: ServerId,
    ids: string[],
    locations: readonly string[],
    options: { timeScale: 1 | 6 | 24; date: string; endDate?: string; qualities?: number[] },
  ) {
    const url = AlbionClient.buildUrl(server, "history", ids, {
      locations: locations.join(","),
      qualities: options.qualities?.join(","),
      "time-scale": String(options.timeScale),
      date: options.date,
      end_date: options.endDate,
    });
    return this.fetchRows<HistorySeries>(url, historySeriesSchema);
  }

  async getOrderbook(server: ServerId, ids: string[], locations: readonly string[], qualities?: number[]) {
    const url = AlbionClient.buildUrl(server, "orderbook", ids, {
      locations: locations.join(","),
      qualities: qualities?.join(","),
    });
    return this.fetchRows<OrderbookEntry>(url, orderbookEntrySchema);
  }

  private async fetchRows<T>(url: string, schema: z.ZodType<T>): Promise<FetchResult<T>> {
    if (url.length > 4096) throw new AlbionApiError("invalid_response", `URL too long (${url.length} > 4096)`);
    if (url.length > MAX_URL_LENGTH) {
      // Still valid for the API, but our batching should never produce this.
      console.warn(`[albion] URL length ${url.length} exceeds soft limit ${MAX_URL_LENGTH}`);
    }
    const body = await this.request(url, true);
    const parsed = parseRows(schema, body);
    if (!parsed) {
      throw this.fail(new AlbionApiError("invalid_response", "The API returned an unexpected format (not an array)."));
    }
    if (parsed.invalid > 0) console.warn(`[albion] ${parsed.invalid} invalid rows dropped from ${url}`);
    return { rows: parsed.rows, invalidRows: parsed.invalid, url };
  }

  private async request(url: string, allowRetry: boolean): Promise<unknown> {
    let res: Response;
    try {
      res = await this.limiter.schedule(() =>
        this.fetchFn(url, {
          headers: {
            // Mandatory: requests without compression are limited to 1 req / 5 min by the API.
            "Accept-Encoding": "gzip, deflate, br",
            Accept: "application/json",
            "User-Agent": "albion-trade-intelligence/0.1 (local market dashboard)",
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          cache: "no-store",
        }),
      );
    } catch (err) {
      const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw this.fail(
        new AlbionApiError(
          isTimeout ? "timeout" : "network",
          isTimeout ? "The Albion Data API timed out." : `Could not reach the Albion Data API: ${(err as Error).message}`,
        ),
      );
    }

    if (res.status === 429) {
      const retryAt = this.parseReset(res);
      this.limiter.pauseUntil(retryAt);
      const waitMs = retryAt - this.now();
      if (allowRetry && waitMs <= MAX_INLINE_RETRY_WAIT_MS) {
        await this.sleep(Math.max(waitMs, 0));
        return this.request(url, false);
      }
      throw this.fail(
        new AlbionApiError("rate_limited", "Albion Data API rate limit reached (HTTP 429).", 429, retryAt),
      );
    }

    if (!res.ok) {
      throw this.fail(new AlbionApiError("http", `The Albion Data API returned HTTP ${res.status}.`, res.status));
    }

    const text = await res.text();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // The API answers throttled requests with a plain-text body in some cases.
      if (/throttled/i.test(text)) {
        const retryAt = this.now() + DEFAULT_429_BACKOFF_MS;
        this.limiter.pauseUntil(retryAt);
        throw this.fail(new AlbionApiError("rate_limited", "The Albion Data API is throttling requests.", res.status, retryAt));
      }
      throw this.fail(new AlbionApiError("invalid_response", "The API response is not JSON."));
    }
  }

  private parseReset(res: Response): number {
    const header = res.headers.get("RateLimit-Reset") ?? res.headers.get("Retry-After");
    const n = header ? Number(header) : NaN;
    if (Number.isFinite(n) && n > 0) {
      // RateLimit-Reset is epoch seconds; Retry-After would be a delta in seconds.
      return n > 1_000_000_000 ? n * 1000 : this.now() + n * 1000;
    }
    return this.now() + DEFAULT_429_BACKOFF_MS;
  }

  private fail(err: AlbionApiError): AlbionApiError {
    this.lastError = { message: err.message, at: this.now() };
    return err;
  }
}
