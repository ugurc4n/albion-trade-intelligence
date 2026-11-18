"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchOpportunities } from "@/lib/api-client";
import type { Filters, OpportunitiesRequest } from "@/lib/settings/schema";
import { useSettings } from "./use-settings";

export function useOpportunities(kind: OpportunitiesRequest["kind"], filters: Filters, limit = 500) {
  const { settings, hydrated } = useSettings();
  return useQuery({
    queryKey: ["opportunities", kind, limit, settings, filters],
    queryFn: ({ signal }) => fetchOpportunities({ settings, filters, kind, limit }, signal),
    enabled: hydrated,
    placeholderData: keepPreviousData,
    // Server caches prices for 5 minutes; refreshing more often would only return the same snapshot.
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}
