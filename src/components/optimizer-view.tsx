"use client";

import { BasketTable } from "@/components/basket-table";
import { FiltersBar } from "@/components/filters-bar";
import { DataStatus, Disclaimer, KpiStrip, PageHeader, Panel } from "@/components/page-parts";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/states";
import { ProfitValue, Silver } from "@/components/values";
import { useOpportunities } from "@/hooks/use-opportunities";
import { usePageFilters } from "@/hooks/use-page-filters";
import { useSettings } from "@/hooks/use-settings";
import { formatPercent } from "@/lib/format";
import { RISK_PARAMS } from "@/lib/scoring/risk-params";
import { DEFAULT_FILTERS, RISK_PREFERENCE_LABELS } from "@/lib/settings/schema";

export function OptimizerView() {
  const { settings } = useSettings();
  const { filters, update, reset } = usePageFilters((s) => ({ buyCity: s.homeCity }));
  const query = useOpportunities("all", filters ?? DEFAULT_FILTERS, 1);
  const basket = query.data?.basket;
  const params = RISK_PARAMS[settings.riskPreference];

  return (
    <div className="pb-4">
      <PageHeader section="optimizer"
        title="Budget Optimizer"
        description={`Spreads the trade budget (${formatPercent(settings.tradeBudget / Math.max(1, settings.totalSilver))} of total silver) over diversified positions in score order. Risk preference: ${RISK_PREFERENCE_LABELS[settings.riskPreference]}.`}
        actions={<DataStatus meta={query.data?.meta} isFetching={query.isFetching} onRefresh={() => query.refetch()} />}
      />
      <div className="space-y-3 px-3 lg:px-4">
        <KpiStrip
          items={[
            { label: "Trade budget", value: <Silver value={settings.tradeBudget} compact /> },
            {
              label: "Total investment",
              value: <Silver value={basket?.totalInvestment ?? null} compact />,
              sub: "all buy/sell fees included",
            },
            {
              label: "Estimated profit",
              tip: "If every order fills at the suggested prices. Not guaranteed, and not a daily earnings estimate.",
              value: <ProfitValue value={basket?.estimatedProfit ?? null} compact />,
              sub: basket && basket.totalInvestment > 0 ? `${formatPercent(basket.estimatedProfit / basket.totalInvestment)} basket ROI` : undefined,
            },
            { label: "Unused budget", value: <Silver value={basket?.unusedBudget ?? null} compact /> },
            {
              label: "Untouched capital",
              value: <Silver value={basket?.reservedCapital ?? Math.max(0, settings.totalSilver - settings.tradeBudget)} compact />,
              sub: "total silver − trade budget",
            },
          ]}
        />

        <Panel>
          {filters && <FiltersBar filters={filters} onChange={update} onReset={reset} variant="basket" />}
          {query.isError && !query.data ? (
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          ) : !basket ? (
            <TableSkeleton rows={6} note="Scanning the market…" />
          ) : basket.lines.length === 0 ? (
            <EmptyState title="No reliable opportunities for the basket">
              Opportunities flagged as stale, anomalous or extreme ROI, and items over budget, are left out of the basket.
            </EmptyState>
          ) : (
            <BasketTable basket={basket} />
          )}
        </Panel>

        <Panel title="Algorithm rules">
          <ul className="list-disc space-y-1 py-3 pr-3 pl-7 text-xs text-muted-foreground">
            <li>One position per item (the highest-scoring Quality/route); at most 12 positions.</li>
            <li>
              Budget cap per position: low risk {formatPercent(params.maxBudgetShare.low)}, medium {formatPercent(params.maxBudgetShare.medium)}, high{" "}
              {formatPercent(params.maxBudgetShare.high)}, no volume data {formatPercent(params.unknownVolumeShare)}.
            </li>
            <li>
              Quantity is capped at {formatPercent(params.volumeShare)} of observed daily volume × {params.maxHoldDays} days (split between the order
              sides). For Instant Buy/Instant Sell trades the Order Book depth (quantity within 3% of the price) is checked
              {query.data && !query.data.orderbookChecked && " — not used in this scan because there were no Instant Buy/Instant Sell candidates"}.
            </li>
            <li>Opportunities flagged as stale, price outliers or above 150% ROI are left out of the basket.</li>
            <li>The basket does not guarantee that the items can actually be bought or sold.</li>
          </ul>
        </Panel>
        <Disclaimer />
      </div>
    </div>
  );
}
