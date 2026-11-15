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
        title="Bütçe Optimizer"
        description={`Ticaret bütçesini (${formatPercent(settings.tradeBudget / Math.max(1, settings.totalSilver))} servet) skor sırasına göre çeşitlendirilmiş pozisyonlara dağıtır. Risk tercihi: ${RISK_PREFERENCE_LABELS[settings.riskPreference]}.`}
        actions={<DataStatus meta={query.data?.meta} isFetching={query.isFetching} onRefresh={() => query.refetch()} />}
      />
      <div className="space-y-3 px-3 lg:px-4">
        <KpiStrip
          items={[
            { label: "Ticaret bütçesi", value: <Silver value={settings.tradeBudget} compact /> },
            {
              label: "Toplam yatırım",
              value: <Silver value={basket?.totalInvestment ?? null} compact />,
              sub: "tüm alış/satış ücretleri dahil",
            },
            {
              label: "Tahmini kâr",
              tip: "Tüm emirlerin önerilen fiyatlardan dolması halinde. Garanti değildir; günlük kazanç tahmini değildir.",
              value: <ProfitValue value={basket?.estimatedProfit ?? null} compact />,
              sub: basket && basket.totalInvestment > 0 ? `${formatPercent(basket.estimatedProfit / basket.totalInvestment)} sepet ROI` : undefined,
            },
            { label: "Kullanılmayan bütçe", value: <Silver value={basket?.unusedBudget ?? null} compact /> },
            {
              label: "Dokunulmayan sermaye",
              value: <Silver value={basket?.reservedCapital ?? Math.max(0, settings.totalSilver - settings.tradeBudget)} compact />,
              sub: "toplam servet − ticaret bütçesi",
            },
          ]}
        />

        <Panel>
          {filters && <FiltersBar filters={filters} onChange={update} onReset={reset} variant="basket" />}
          {query.isError && !query.data ? (
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          ) : !basket ? (
            <TableSkeleton rows={6} note="Piyasa taranıyor…" />
          ) : basket.lines.length === 0 ? (
            <EmptyState title="Sepete alınabilecek güvenilir fırsat yok">
              Eski veri, anomali veya aşırı ROI işaretli fırsatlar ve bütçeyi aşan ürünler sepete alınmaz.
            </EmptyState>
          ) : (
            <BasketTable basket={basket} />
          )}
        </Panel>

        <Panel title="Algoritma kuralları">
          <ul className="list-disc space-y-1 py-3 pr-3 pl-7 text-xs text-muted-foreground">
            <li>Her ürün için tek pozisyon (en yüksek skorlu kalite/rota); en fazla 12 pozisyon.</li>
            <li>
              Pozisyon başına bütçe tavanı: düşük risk {formatPercent(params.maxBudgetShare.low)}, orta {formatPercent(params.maxBudgetShare.medium)}, yüksek{" "}
              {formatPercent(params.maxBudgetShare.high)}, hacim verisi yok {formatPercent(params.unknownVolumeShare)}.
            </li>
            <li>
              Adet, gözlemlenen günlük hacmin {formatPercent(params.volumeShare)}&apos;i × {params.maxHoldDays} gün ile sınırlanır (emir tarafları arasında
              bölünür). Anında işlemlerde emir defteri derinliği (fiyatın %3 yakınındaki miktar) kontrol edilir
              {query.data && !query.data.orderbookChecked && " — bu taramada anında işlem adayı olmadığı için kullanılmadı"}.
            </li>
            <li>Eski veri, fiyat anomalisi ve %150 üzeri ROI işaretli fırsatlar sepete alınmaz.</li>
            <li>Sepet, ürünlerin gerçekten alınabileceğini veya satılabileceğini garanti etmez.</li>
          </ul>
        </Panel>
        <Disclaimer />
      </div>
    </div>
  );
}
