"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { BasketTable } from "@/components/basket-table";
import { OpportunityTable } from "@/components/opportunity-table";
import { DataStatus, Disclaimer, KpiStrip, PageHeader, Panel } from "@/components/page-parts";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/states";
import { ProfitValue, Silver } from "@/components/values";
import { useOpportunities } from "@/hooks/use-opportunities";
import { usePageFilters } from "@/hooks/use-page-filters";
import { useNow } from "@/hooks/use-now";
import { useSettings } from "@/hooks/use-settings";
import { ageFrom, formatAge, formatCompact } from "@/lib/format";
import { DEFAULT_FILTERS } from "@/lib/settings/schema";

const COMPACT_HIDE = ["buyMax", "sellMin", "capital", "confidence", "volume"];

function MoreLink({ href }: { href: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
      View all <ArrowRight className="size-3" />
    </Link>
  );
}

export function DashboardView() {
  const { settings } = useSettings();
  const now = useNow();
  const { filters } = usePageFilters((s) => ({ buyCity: s.homeCity }));
  const query = useOpportunities("all", filters ?? DEFAULT_FILTERS, 8);
  const data = query.data;
  const fetchedAge = ageFrom(data?.meta.prices.oldestFetchAt, now);

  return (
    <div className="pb-4">
      <PageHeader section="dashboard"
        title="Dashboard"
        description={`Opportunities from ${settings.homeCity} · ${settings.premium ? "Premium" : "non-Premium"} Sales Tax · min. ROI ${Math.round(settings.minRoi * 100)}% · max. data age ${formatAge(settings.maxDataAgeMinutes)}`}
        actions={<DataStatus meta={data?.meta} isFetching={query.isFetching} onRefresh={() => query.refetch()} />}
      />

      <div className="space-y-3 px-3 lg:px-4">
        <KpiStrip
          items={[
            {
              label: "Trade budget",
              value: <Silver value={settings.tradeBudget} compact />,
              sub: (
                <>
                  Total {formatCompact(settings.totalSilver)} · untouched {formatCompact(Math.max(0, settings.totalSilver - settings.tradeBudget))}
                </>
              ),
            },
            {
              label: "Filtered opportunities",
              value: <span className="num">{data ? data.summary.opportunityCount : "—"}</span>,
              sub: data ? `${data.flips.total} flips · ${data.trades.total} cross-city` : "scanning…",
            },
            {
              label: "Top potential net profit",
              tip: "Suggested quantity × net profit per unit for a single opportunity. Stale, anomalous or unprofitable opportunities are excluded. Not guaranteed.",
              value: <ProfitValue value={data?.summary.topPotentialProfit ?? null} compact />,
              sub: "at suggested quantity, estimated",
            },
            {
              label: "Suggested basket",
              tip: "The Budget Optimizer's diversified basket. All fees are included in the capital.",
              value: <ProfitValue value={data?.basket.estimatedProfit ?? null} compact />,
              sub: data ? (
                <>
                  {formatCompact(data.basket.totalInvestment)} invested · {formatCompact(data.basket.unusedBudget)} unused
                </>
              ) : (
                "—"
              ),
            },
            {
              label: "Data status",
              value: <span className="num">{data ? `${formatAge(fetchedAge)}` : "—"}</span>,
              sub: data
                ? `${data.meta.prices.loaded}/${data.meta.prices.total} price · ${data.meta.history.loaded}/${data.meta.history.total} volume batches`
                : "loading",
            },
          ]}
        />

        {query.isError && !data ? (
          <Panel>
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          </Panel>
        ) : (
          <>
            <Panel title="Suggested trades" actions={<MoreLink href="/optimizer" />}>
              {!data ? (
                <TableSkeleton rows={4} note="Scanning the market…" />
              ) : data.basket.lines.length === 0 ? (
                <EmptyState title="No reliable opportunity fits the budget">
                  Stale, anomalous or over-budget opportunities are left out of the basket. Try loosening the filters or settings.
                </EmptyState>
              ) : (
                <BasketTable basket={{ ...data.basket, lines: data.basket.lines.slice(0, 6) }} compact />
              )}
            </Panel>

            <div className="grid gap-3 2xl:grid-cols-2">
              <Panel title={`Market Flipping · ${settings.homeCity}`} actions={<MoreLink href="/flipping" />}>
                {!data ? (
                  <TableSkeleton rows={6} />
                ) : data.flips.items.length === 0 ? (
                  <EmptyState title="No flip opportunities" />
                ) : (
                  <OpportunityTable
                    data={data.flips.items}
                    variant="flip"
                    maxDataAge={settings.maxDataAgeMinutes}
                    paginate={false}
                    hideColumns={COMPACT_HIDE}
                  />
                )}
              </Panel>
              <Panel title={`Cross-City Trade · from ${settings.homeCity}`} actions={<MoreLink href="/trade" />}>
                {!data ? (
                  <TableSkeleton rows={6} />
                ) : data.trades.items.length === 0 ? (
                  <EmptyState title="No cross-city opportunities" />
                ) : (
                  <OpportunityTable
                    data={data.trades.items}
                    variant="trade"
                    maxDataAge={settings.maxDataAgeMinutes}
                    paginate={false}
                    hideColumns={COMPACT_HIDE}
                  />
                )}
              </Panel>
            </div>
          </>
        )}
        <Disclaimer />
      </div>
    </div>
  );
}
