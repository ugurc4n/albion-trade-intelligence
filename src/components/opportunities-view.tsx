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
      "Aynı şehirde alış emri (en yüksek alış emrinin 1 silver üstü) verip satış emri (en düşük satış emrinin 1 silver altı) ile satma fırsatları. Görünen fark kesin kazanç değildir; emirler dolmayabilir veya fiyatlar değişebilir.",
  },
  trade: {
    title: "Şehirler Arası Ticaret",
    description:
      "Kraliyet şehirleri (Martlock, Lymhurst, Bridgewatch, Fort Sterling, Thetford) arasında güvenli rotalar. Caerleon ve Brecilien hariç. Anında alım/satım ile emir fiyatları ayrı senaryolar olarak hesaplanır.",
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
          <TableSkeleton note="Piyasa verisi taranıyor. İlk yüklemede ~70 toplu istek yapılır; sonraki istekler 5 dk önbellekten gelir." />
        ) : list.items.length === 0 ? (
          <EmptyState title="Filtrelere uyan fırsat bulunamadı">
            Min. ROI ({Math.round((filters?.minRoi ?? settings.minRoi) * 100)}%), veri yaşı sınırı veya şehir filtresini gevşetmeyi deneyin. Eski veya
            belirsiz fiyatlar bilinçli olarak gizlenir.
          </EmptyState>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
              <span>
                <span className="num text-foreground">{list.total}</span> fırsat
                {list.total > list.items.length && ` (ilk ${list.items.length} gösteriliyor)`} · skora göre sıralı · ayrıntı için satıra tıklayın
              </span>
              {query.isFetching && <span>güncelleniyor…</span>}
            </div>
            <OpportunityTable data={list.items} variant={variant} maxDataAge={maxAge} />
          </>
        )}
      </div>
      <Disclaimer className="px-3 py-3 lg:px-4" />
    </div>
  );
}
