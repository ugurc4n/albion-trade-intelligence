"use client";

import { useCallback, useState } from "react";
import { DEFAULT_FILTERS, type Filters, type Settings } from "@/lib/settings/schema";
import { useSettings } from "./use-settings";

/**
 * Page-level filter state, initialised from user settings once they are loaded from localStorage.
 * Returns null until then so queries never run with the wrong home city.
 */
export function usePageFilters(initial: (settings: Settings) => Partial<Filters>) {
  const { settings, hydrated } = useSettings();
  const [filters, setFilters] = useState<Filters | null>(null);

  // Seed once, during render, as soon as settings are hydrated ("adjust state while rendering" pattern).
  if (hydrated && filters === null) {
    setFilters({ ...DEFAULT_FILTERS, ...initial(settings) });
  }

  const update = useCallback(
    (patch: Partial<Filters>) => setFilters((prev) => ({ ...(prev ?? DEFAULT_FILTERS), ...patch })),
    [],
  );
  const reset = () => setFilters({ ...DEFAULT_FILTERS, ...initial(settings) });

  return { filters, update, reset };
}
