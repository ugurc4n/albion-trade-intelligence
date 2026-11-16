"use client";

import { FiltersBar } from "@/components/filters-bar";
import { OpportunityTable } from "@/components/opportunity-table";
import { DataStatus, Disclaimer, PageHeader } from "@/components/page-parts";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/states";
import { useOpportunities } from "@/hooks/use-opportunities";
import { usePageFilters } from "@/hooks/use-page-filters";
import { useSettings } from "@/hooks/use-settings";
import { DEFAULT_FILTERS } from "@/lib/settings/schema";

const COPY = {
  flip: {
    title: "Market Flipping",
    description:
      "Place a Buy Order (1 silver above the highest Buy Order) and resell with a Sell Order (1 silver below the lowest Sell Order) in the same city. The spread shown is not guaranteed profit; orders may not fill and prices may move.",
  },
  trade: {
    title: "Cross-City Trade",
    description:
      "Safe routes between the Royal Cities (Martlock, Lymhurst, Bridgewatch, Fort Sterling, Thetford), excluding Caerleon and Brecilien. Instant Buy/Instant Sell and Buy Order/Sell Order prices are calculated as separate scenarios.",
  },
} as const;

export function OpportunitiesView({ variant }: { variant: "flip" | "trade" }) {
  const { settings } = useSettings();
  const { filters, update, reset } = usePageFilters((s) => ({ buyCity: s.homeCity }));
  const query = useOpportunities(variant, filters ?? DEFAULT_FILTERS, 1000);
  const list = variant === "flip" ? query.data?.flips : query.data?.trades;
  const maxAge = filters?.maxDataAgeMinutes ?? settings.maxDataAgeMinutes;

  return (
    <div>
      <PageHeader section={variant === "flip" ? "flipping" : "trade"}
        title={COPY[variant].title}
        description={COPY[variant].description}
        actions={<DataStatus meta={query.data?.meta} isFetching={query.isFetching} onRefresh={() => query.refetch()} />}
      />
      <div className="mx-3 overflow-hidden rounded-lg border border-border bg-card lg:mx-4">
        {filters && <FiltersBar filters={filters} onChange={update} onReset={reset} variant={variant} />}
        {query.isError && !query.data ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : !list ? (
          <TableSkeleton note="Scanning market data. The first load makes ~70 batched requests; later requests come from a 5-minute cache." />
        ) : list.items.length === 0 ? (
          <EmptyState title="No opportunities match the filters">
            Try loosening the min. ROI ({Math.round((filters?.minRoi ?? settings.minRoi) * 100)}%), the data-age limit or the city filter. Stale or
            uncertain prices are hidden on purpose.
          </EmptyState>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
              <span>
                <span className="num text-foreground">{list.total}</span> opportunities
                {list.total > list.items.length && ` (showing first ${list.items.length})`} · sorted by score · click a row for details
              </span>
              {query.isFetching && <span>updating…</span>}
            </div>
            <OpportunityTable data={list.items} variant={variant} maxDataAge={maxAge} />
          </>
        )}
      </div>
      <Disclaimer className="px-3 py-3 lg:px-4" />
    </div>
  );
}
