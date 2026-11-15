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
      Tümü <ArrowRight className="size-3" />
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
        title="Panel"
        description={`${settings.homeCity} çıkışlı fırsatlar · ${settings.premium ? "Premium" : "Premium yok"} vergileriyle · min. ROI %${Math.round(settings.minRoi * 100)} · maks. veri yaşı ${formatAge(settings.maxDataAgeMinutes)}`}
        actions={<DataStatus meta={data?.meta} isFetching={query.isFetching} onRefresh={() => query.refetch()} />}
      />

      <div className="space-y-3 px-3 lg:px-4">
        <KpiStrip
          items={[
            {
              label: "Ticaret bütçesi",
              value: <Silver value={settings.tradeBudget} compact />,
              sub: (
                <>
                  Toplam {formatCompact(settings.totalSilver)} · dokunulmayan {formatCompact(Math.max(0, settings.totalSilver - settings.tradeBudget))}
                </>
              ),
            },
            {
              label: "Filtrelenmiş fırsat",
              value: <span className="num">{data ? data.summary.opportunityCount : "—"}</span>,
              sub: data ? `${data.flips.total} flip · ${data.trades.total} şehirler arası` : "taranıyor…",
            },
            {
              label: "En yüksek potansiyel net kâr",
              tip: "Tek fırsat için önerilen adet × birim net kâr. Eski, anormal veya kârsız fırsatlar hariç. Garanti değildir.",
              value: <ProfitValue value={data?.summary.topPotentialProfit ?? null} compact />,
              sub: "önerilen adetle, tahmini",
            },
            {
              label: "Önerilen sepet",
              tip: "Bütçe optimizer'ının çeşitlendirilmiş sepeti. Tüm ücretler sermayeye dahildir.",
              value: <ProfitValue value={data?.basket.estimatedProfit ?? null} compact />,
              sub: data ? (
                <>
                  {formatCompact(data.basket.totalInvestment)} yatırım · {formatCompact(data.basket.unusedBudget)} kullanılmıyor
                </>
              ) : (
                "—"
              ),
            },
            {
              label: "Veri durumu",
              value: <span className="num">{data ? `${formatAge(fetchedAge)}` : "—"}</span>,
              sub: data
                ? `${data.meta.prices.loaded}/${data.meta.prices.total} fiyat · ${data.meta.history.loaded}/${data.meta.history.total} hacim paketi`
                : "yükleniyor",
            },
          ]}
        />

        {query.isError && !data ? (
          <Panel>
            <ErrorState error={query.error} onRetry={() => query.refetch()} />
          </Panel>
        ) : (
          <>
            <Panel title="Önerilen işlemler" actions={<MoreLink href="/optimizer" />}>
              {!data ? (
                <TableSkeleton rows={4} note="Piyasa taranıyor…" />
              ) : data.basket.lines.length === 0 ? (
                <EmptyState title="Bütçeye uygun, güvenilir fırsat yok">
                  Eski, anormal veya bütçeyi aşan fırsatlar sepete alınmaz. Filtreleri veya ayarları gevşetmeyi deneyin.
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
                  <EmptyState title="Uygun flip fırsatı yok" />
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
              <Panel title={`Şehirler arası · ${settings.homeCity} çıkışlı`} actions={<MoreLink href="/trade" />}>
                {!data ? (
                  <TableSkeleton rows={6} />
                ) : data.trades.items.length === 0 ? (
                  <EmptyState title="Uygun şehirler arası fırsat yok" />
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
