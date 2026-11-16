import { describe, expect, it, vi } from "vitest";
import { chunkIds } from "./batching";
import { TtlCache } from "./cache";
import { AlbionApiError, AlbionClient } from "./client";
import { MAX_URL_LENGTH, ROYAL_CITIES } from "./constants";
import { RateLimiter } from "./rate-limiter";

const priceRow = {
  item_id: "T4_BAG",
  city: "Martlock",
  quality: 1,
  sell_price_min: 3896,
  sell_price_min_date: "2026-11-14T18:15:00",
  sell_price_max: 3900,
  sell_price_max_date: "2026-11-14T18:15:00",
  buy_price_min: 13,
  buy_price_min_date: "2026-11-14T18:15:00",
  buy_price_max: 2823,
  buy_price_max_date: "2026-11-14T18:15:00",
};

function fastLimiter() {
  return new RateLimiter({ windows: [{ limit: 1000, intervalMs: 60_000 }], maxConcurrent: 5, sleep: async () => {} });
}

describe("chunkIds", () => {
  it("keeps every generated URL under the limit and preserves all ids in order", () => {
    const ids = Array.from({ length: 900 }, (_, i) => `T${(i % 8) + 1}_ITEM_NUMBER_${i}@${i % 4}`);
    const build = (chunk: string[]) =>
      AlbionClient.buildUrl("europe", "history", chunk, { locations: ROYAL_CITIES.join(","), "time-scale": "24", date: "2026-11-01" });
    const chunks = chunkIds(ids, build, MAX_URL_LENGTH);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(build(c).length).toBeLessThanOrEqual(MAX_URL_LENGTH);
    expect(chunks.flat()).toEqual(ids);
  });

  it("throws when a single id can never fit", () => {
    expect(() => chunkIds(["X".repeat(50)], (c) => c.join(","), 10)).toThrow();
  });
});

describe("AlbionClient", () => {
  it("sends compression headers and validates rows, dropping malformed ones", async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Accept-Encoding")).toMatch(/gzip/);
      return new Response(JSON.stringify([priceRow, { item_id: 5 }]), { status: 200 });
    });
    const client = new AlbionClient({ limiter: fastLimiter(), fetchFn: fetchFn as typeof fetch });
    const res = await client.getPrices("europe", ["T4_BAG"], ROYAL_CITIES);
    expect(res.rows).toHaveLength(1);
    expect(res.invalidRows).toBe(1);
    expect(res.url).toContain("/api/v2/stats/prices/T4_BAG.json?locations=Martlock");
  });

  it("waits for RateLimit-Reset and retries once on a short 429", async () => {
    let now = 1_000_000_000_000;
    const sleeps: number[] = [];
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return new Response("Throttled", { status: 429, headers: { "RateLimit-Reset": String(Math.floor(now / 1000) + 5) } });
      }
      return new Response(JSON.stringify([priceRow]), { status: 200 });
    });
    const sleep = async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    };
    const limiter = new RateLimiter({ windows: [{ limit: 100, intervalMs: 60_000 }], maxConcurrent: 2, now: () => now, sleep });
    const client = new AlbionClient({ limiter, fetchFn: fetchFn as typeof fetch, now: () => now, sleep });
    const res = await client.getPrices("europe", ["T4_BAG"], ROYAL_CITIES);
    expect(res.rows).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleeps.some((s) => s >= 4000)).toBe(true);
  });

  it("fails with a rate_limited error and pauses the limiter on a long 429", async () => {
    const now = 1_000_000_000_000;
    const fetchFn = vi.fn(
      async () => new Response("", { status: 429, headers: { "RateLimit-Reset": String(Math.floor(now / 1000) + 300) } }),
    );
    const limiter = new RateLimiter({ windows: [{ limit: 100, intervalMs: 60_000 }], maxConcurrent: 2, now: () => now, sleep: async () => {} });
    const client = new AlbionClient({ limiter, fetchFn: fetchFn as typeof fetch, now: () => now });
    const err = await client.getPrices("europe", ["T4_BAG"], ROYAL_CITIES).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AlbionApiError);
    expect((err as AlbionApiError).kind).toBe("rate_limited");
    expect((err as AlbionApiError).retryAt).toBe((Math.floor(now / 1000) + 300) * 1000);
    expect(limiter.getPausedUntil()).toBe((Math.floor(now / 1000) + 300) * 1000);
  });

  it("reports HTTP and invalid JSON errors", async () => {
    const client500 = new AlbionClient({ limiter: fastLimiter(), fetchFn: (async () => new Response("x", { status: 500 })) as typeof fetch });
    await expect(client500.getPrices("europe", ["T4_BAG"], ROYAL_CITIES)).rejects.toMatchObject({ kind: "http", status: 500 });
    const clientBad = new AlbionClient({ limiter: fastLimiter(), fetchFn: (async () => new Response("{}", { status: 200 })) as typeof fetch });
    await expect(clientBad.getPrices("europe", ["T4_BAG"], ROYAL_CITIES)).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("rejects malformed item ids before building a URL", () => {
    expect(() => AlbionClient.buildUrl("europe", "prices", ["T4_BAG&x=1"], {})).toThrow(AlbionApiError);
  });
});

describe("RateLimiter", () => {
  it("never exceeds the window limit", async () => {
    // Fake timers: wall-clock sampling inside tasks under parallel load used to make this flaky.
    vi.useFakeTimers({ now: 0 });
    try {
      const interval = 80;
      const limiter = new RateLimiter({ windows: [{ limit: 3, intervalMs: interval }], maxConcurrent: 10 });
      const starts: number[] = [];
      const done = Promise.all(Array.from({ length: 7 }, () => limiter.schedule(async () => starts.push(Date.now()))));
      await vi.runAllTimersAsync();
      await done;
      // A slot frees up 1ms after the oldest request leaves the (now - interval, now] window.
      expect(starts).toEqual([0, 0, 0, 81, 81, 81, 162]);
      for (const t of starts) expect(starts.filter((s) => s > t - interval && s <= t).length).toBeLessThanOrEqual(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not over-admit when a timer wakes up early", async () => {
    // Timers may fire slightly before the requested delay; the limiter must re-check and wait again.
    let now = 0;
    const interval = 80;
    const sleep = async (ms: number) => {
      now += Math.max(0, ms - 1);
    };
    const limiter = new RateLimiter({ windows: [{ limit: 2, intervalMs: interval }], maxConcurrent: 10, now: () => now, sleep });
    const starts: number[] = [];
    for (let i = 0; i < 6; i++) await limiter.schedule(async () => starts.push(now));
    for (const t of starts) expect(starts.filter((s) => s > t - interval && s <= t).length).toBeLessThanOrEqual(2);
  });

  it("respects the concurrency cap", async () => {
    const limiter = new RateLimiter({ windows: [{ limit: 100, intervalMs: 1000 }], maxConcurrent: 2 });
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        limiter.schedule(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 10));
          active--;
        }),
      ),
    );
    expect(peak).toBe(2);
  });
});

describe("TtlCache", () => {
  it("de-duplicates concurrent loads and serves stale values while refreshing", async () => {
    let now = 0;
    const cache = new TtlCache(10, () => now);
    let loads = 0;
    const loader = async () => ++loads;
    const [a, b] = await Promise.all([cache.get("k", 100, loader), cache.get("k", 100, loader)]);
    expect(a.value).toBe(1);
    expect(b.value).toBe(1);
    expect(loads).toBe(1);

    now = 500;
    const stale = await cache.get("k", 100, loader);
    expect(stale.stale).toBe(true);
    expect(stale.value).toBe(1);
    await new Promise((r) => setTimeout(r, 0));
    expect((await cache.get("k", 100, loader)).value).toBe(2);
  });

  it("keeps the old value when a refresh fails and does not cache first-load failures", async () => {
    let now = 0;
    const cache = new TtlCache(10, () => now);
    await cache.get("k", 100, async () => "v1");
    now = 500;
    await cache.get("k", 100, async () => {
      throw new Error("boom");
    });
    await new Promise((r) => setTimeout(r, 0));
    const after = await cache.get("k", 100, async () => "v2");
    expect(after.value).toBe("v1");
    expect(after.refreshError).toBe("boom");

    await expect(
      cache.get("other", 100, async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");
    expect(cache.peek("other")).toBeUndefined();
  });
});
