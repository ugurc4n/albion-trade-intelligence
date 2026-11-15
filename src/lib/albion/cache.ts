type Entry<T> = {
  value?: T;
  fetchedAt: number;
  error?: string;
  inflight?: Promise<T>;
};

export type CacheResult<T> = {
  value: T;
  fetchedAt: number;
  /** True when the value is older than the TTL and a background refresh was started. */
  stale: boolean;
  /** Message of the last failed refresh, when a stale value is being served. */
  refreshError?: string;
};

/**
 * Small in-memory TTL cache with in-flight de-duplication and stale-while-revalidate.
 * Sufficient for a single Node process; no external infrastructure required.
 */
export class TtlCache {
  private readonly map = new Map<string, Entry<unknown>>();

  constructor(
    private readonly maxEntries = 1000,
    private readonly now: () => number = Date.now,
  ) {}

  async get<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<CacheResult<T>> {
    const entry = this.map.get(key) as Entry<T> | undefined;
    const now = this.now();

    if (entry && entry.value !== undefined) {
      const age = now - entry.fetchedAt;
      if (age <= ttlMs) return { value: entry.value, fetchedAt: entry.fetchedAt, stale: false };
      if (!entry.inflight) this.refresh(key, entry, loader).catch(() => undefined);
      return { value: entry.value, fetchedAt: entry.fetchedAt, stale: true, refreshError: entry.error };
    }

    if (entry?.inflight) {
      const value = await entry.inflight;
      const settled = this.map.get(key) as Entry<T>;
      return { value, fetchedAt: settled.fetchedAt, stale: false };
    }

    const fresh: Entry<T> = entry ?? { fetchedAt: 0 };
    const value = await this.refresh(key, fresh, loader);
    return { value, fetchedAt: fresh.fetchedAt, stale: false };
  }

  /** Returns the cached value without triggering any fetch. */
  peek<T>(key: string): { value: T; fetchedAt: number } | undefined {
    const entry = this.map.get(key) as Entry<T> | undefined;
    if (!entry || entry.value === undefined) return undefined;
    return { value: entry.value, fetchedAt: entry.fetchedAt };
  }

  /** Stores a value fetched outside of get() (e.g. one item out of a batched response). */
  put<T>(key: string, value: T): void {
    this.set(key, { value, fetchedAt: this.now() });
  }

  size(): number {
    return this.map.size;
  }

  private refresh<T>(key: string, entry: Entry<T>, loader: () => Promise<T>): Promise<T> {
    this.set(key, entry);
    const promise = loader()
      .then((value) => {
        entry.value = value;
        entry.fetchedAt = this.now();
        entry.error = undefined;
        return value;
      })
      .catch((err: unknown) => {
        entry.error = err instanceof Error ? err.message : String(err);
        if (entry.value === undefined) this.map.delete(key);
        throw err;
      })
      .finally(() => {
        entry.inflight = undefined;
      });
    entry.inflight = promise;
    return promise;
  }

  private set(key: string, entry: Entry<unknown>) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, entry);
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}
