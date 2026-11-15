type Window = { limit: number; intervalMs: number };

export type RateLimiterOptions = {
  windows: Window[];
  maxConcurrent: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type RateLimiterStatus = {
  active: number;
  queued: number;
  pausedUntil: number | null;
  windows: { limit: number; intervalMs: number; used: number }[];
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Sliding-window rate limiter with a concurrency cap and a global pause (used after HTTP 429).
 * All outgoing Albion Data API requests go through a single process-wide instance.
 */
export class RateLimiter {
  private readonly windows: Window[];
  private readonly maxConcurrent: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private timestamps: number[] = [];
  private active = 0;
  private queued = 0;
  private pausedUntil = 0;

  constructor(options: RateLimiterOptions) {
    this.windows = options.windows;
    this.maxConcurrent = options.maxConcurrent;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /** Blocks every new request until the given epoch-ms timestamp. */
  pauseUntil(epochMs: number) {
    this.pausedUntil = Math.max(this.pausedUntil, epochMs);
  }

  getPausedUntil(): number | null {
    return this.pausedUntil > this.now() ? this.pausedUntil : null;
  }

  async schedule<T>(task: () => Promise<T>): Promise<T> {
    this.queued++;
    try {
      await this.acquire();
    } finally {
      this.queued--;
    }
    try {
      return await task();
    } finally {
      this.active--;
    }
  }

  status(): RateLimiterStatus {
    const now = this.now();
    return {
      active: this.active,
      queued: this.queued,
      pausedUntil: this.getPausedUntil(),
      windows: this.windows.map((w) => ({
        limit: w.limit,
        intervalMs: w.intervalMs,
        used: this.timestamps.filter((t) => t > now - w.intervalMs).length,
      })),
    };
  }

  private async acquire(): Promise<void> {
    for (;;) {
      const now = this.now();
      if (this.pausedUntil > now) {
        await this.sleep(this.pausedUntil - now);
        continue;
      }
      const longest = Math.max(...this.windows.map((w) => w.intervalMs));
      this.timestamps = this.timestamps.filter((t) => t > now - longest);

      let waitMs = 0;
      for (const w of this.windows) {
        const inWindow = this.timestamps.filter((t) => t > now - w.intervalMs);
        if (inWindow.length >= w.limit) {
          const oldest = inWindow[0];
          waitMs = Math.max(waitMs, oldest + w.intervalMs - now + 1);
        }
      }
      if (waitMs > 0) {
        await this.sleep(waitMs);
        continue;
      }
      if (this.active >= this.maxConcurrent) {
        await this.sleep(25);
        continue;
      }
      this.timestamps.push(now);
      this.active++;
      return;
    }
  }
}
