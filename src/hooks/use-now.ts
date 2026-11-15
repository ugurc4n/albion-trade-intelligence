"use client";

import { useSyncExternalStore } from "react";

const TICK_MS = 30_000;
let current = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      listeners.forEach((l) => l());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

function getSnapshot() {
  if (current === 0) current = Date.now();
  return current;
}

/**
 * Shared clock for "x minutes ago" labels. Null during prerender/hydration (no time-dependent
 * markup is baked into static HTML), then ticks every 30 seconds on the client.
 */
export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
