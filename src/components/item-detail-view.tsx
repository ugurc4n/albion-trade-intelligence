"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FreshnessBadge, TierBadge } from "@/components/badges";
import { ItemIcon } from "@/components/item-icon";
import { OpportunityTable } from "@/components/opportunity-table";
import { Disclaimer, PageHeader, Panel } from "@/components/page-parts";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/states";
import { Silver } from "@/components/values";
import { useOpportunities } from "@/hooks/use-opportunities";
import { useNow } from "@/hooks/use-now";
import { useSettings } from "@/hooks/use-settings";
import { QUALITY_LABELS, ROYAL_CITIES, type City } from "@/lib/albion/constants";
import type { HistorySeries, OrderbookLevel } from "@/lib/albion/schemas";
import { isLevelSuperseded } from "@/lib/market/orderbook";
import { fetchItemDetail, isPart, type ItemDetailResponse } from "@/lib/api-client";
import { categoryLabel } from "@/lib/catalog/types";
import { ageFrom, formatAge, formatCompact, formatDecimal, formatPercent, formatSilver } from "@/lib/format";
import { computeVolumeStats } from "@/lib/market/history";
import { parseApiDate } from "@/lib/market/normalize";
import type { Quote, VolumeStats } from "@/lib/market/types";
import { DEFAULT_FILTERS } from "@/lib/settings/schema";
import { cn } from "@/lib/utils";

const CITY_COLORS: Record<City, string> = {
  Martlock: "var(--chart-1)",
  Lymhurst: "var(--chart-3)",
  Bridgewatch: "var(--chart-5)",
  "Fort Sterling": "var(--chart-2)",
  Thetford: "var(--chart-4)",
};

function cityOf(location: string): City | null {
  const key = location.toLowerCase().replace(/\s+/g, "");
  return ROYAL_CITIES.find((c) => c.toLowerCase().replace(/\s+/g, "") === key) ?? null;
}

function buildChartData(series: HistorySeries[], quality: number) {
  const byDay = new Map<string, Record<string, number | string>>();
  for (const s of series) {
    if (s.quality !== quality) continue;
    const city = cityOf(s.location);
    if (!city) continue;
    for (const p of s.data) {
      const at = parseApiDate(p.timestamp);
      if (at === null) continue;
      const day = new Date(at).toISOString().slice(0, 10);
      const row = byDay.get(day) ?? { day };
      row[`${city}:price`] = p.avg_price;
      row[`${city}:count`] = p.item_count;
      byDay.set(day, row);
    }
  }
  return [...byDay.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)));
}

const tooltipStyle = {
  contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 },
  labelStyle: { color: "var(--muted-foreground)" },
};

/** Upper bound for the price axis that ignores single extreme prints (the data itself is not altered). */
function robustPriceMax(data: Record<string, number | string>[]): { max: number; clipped: boolean } {
  const prices = data
    .flatMap((d) => Object.entries(d).filter(([k]) => k.endsWith(":price")).map(([, v]) => Number(v)))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  if (prices.length === 0) return { max: 0, clipped: false };
  const p95 = prices[Math.min(prices.length - 1, Math.floor(prices.length * 0.95))];
  const top = prices[prices.length - 1];
  const raw = p95 * 1.2;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const max = (Math.ceil((raw / magnitude) * 2) / 2) * magnitude; // e.g. 5.424 → 5.500
  return top > max ? { max, clipped: true } : { max: top, clipped: false };
}

function HistoryCharts({ series, quality }: { series: HistorySeries[]; quality: number }) {
  const data = useMemo(() => buildChartData(series, quality), [series, quality]);
  const { max: priceMax, clipped } = useMemo(() => robustPriceMax(data), [data]);
  const cities = ROYAL_CITIES.filter((c) => data.some((d) => d[`${c}:price`] !== undefined));
  if (data.length === 0) {
    return <EmptyState title="No data">No sales history recorded for this Quality in the last 30 days.</EmptyState>;
  }
  const axis = { stroke: "var(--muted-foreground)", fontSize: 11, tickLine: false };
  return (
    <div className="grid gap-4 p-3 xl:grid-cols-2">
      <div>
        <p className="mb-2 text-xs text-muted-foreground">
          Daily average sell price (actual history)
          {clipped && <span className="text-warn"> · axis clipped at the extremes (there are one-off extreme prices)</span>}
        </p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 256 }}>
            <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="day" {...axis} tickFormatter={(d: string) => d.slice(5)} />
              <YAxis
                {...axis}
                width={56}
                domain={[0, priceMax || "auto"]}
                allowDataOverflow={clipped}
                tickFormatter={(v: number) => formatCompact(v)}
              />
              <Tooltip {...tooltipStyle} formatter={(v) => formatSilver(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {cities.map((c) => (
                <Line
                  key={c}
                  type="monotone"
                  dataKey={`${c}:price`}
                  name={c}
                  stroke={CITY_COLORS[c]}
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs text-muted-foreground">Daily observed sales count (a lower bound on real volume)</p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 256 }}>
            <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="day" {...axis} tickFormatter={(d: string) => d.slice(5)} />
              <YAxis {...axis} width={56} tickFormatter={(v: number) => formatCompact(v)} />
              <Tooltip {...tooltipStyle} cursor={{ fill: "var(--accent)" }} formatter={(v) => formatSilver(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {cities.map((c) => (
                <Bar key={c} dataKey={`${c}:count`} name={c} stackId="v" fill={CITY_COLORS[c]} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function PriceMatrix({
  quotes,
  stats,
  maxAge,
}: {
  quotes: Quote[];
  stats: Map<City, VolumeStats>;
  maxAge: number;
}) {
  const now = useNow();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead className="bg-surface">
          <tr className="border-b border-border text-[11px] tracking-wide text-muted-foreground uppercase">
            <th className="h-8 px-3 text-left font-medium">City</th>
            <th className="px-2 text-right font-medium">Lowest sell</th>
            <th className="px-2 text-left font-medium">Freshness</th>
            <th className="px-2 text-right font-medium">Highest buy</th>
            <th className="px-2 text-left font-medium">Freshness</th>
            <th className="px-2 text-right font-medium">Spread</th>
            <th className="px-2 text-right font-medium">7d avg. price</th>
            <th className="px-2 text-right font-medium">Volume/day</th>
            <th className="px-2 text-right font-medium">Volatility</th>
          </tr>
        </thead>
        <tbody>
          {ROYAL_CITIES.map((city) => {
            const q = quotes.find((x) => x.city === city);
            const s = stats.get(city);
            const spread = q?.sellMin && q?.buyMax ? q.sellMin - q.buyMax : null;
            return (
              <tr key={city} className="border-b border-border/60">
                <td className="px-3 py-1.5 font-medium">{city}</td>
                {q ? (
                  <>
                    <td className="px-2 text-right">
                      <Silver value={q.sellMin} />
                    </td>
                    <td className="px-2">{q.sellMin !== null && <FreshnessBadge minutes={ageFrom(q.sellMinAt, now)} maxMinutes={maxAge} />}</td>
                    <td className="px-2 text-right">
                      <Silver value={q.buyMax} />
                    </td>
                    <td className="px-2">{q.buyMax !== null && <FreshnessBadge minutes={ageFrom(q.buyMaxAt, now)} maxMinutes={maxAge} />}</td>
                    <td className="px-2 text-right">
                      <Silver value={spread} className="text-muted-foreground" />
                    </td>
                  </>
                ) : (
                  <td colSpan={5} className="px-2 text-xs text-muted-foreground">
                    No data
                  </td>
                )}
                <td className="px-2 text-right">
                  <Silver value={s?.avgPrice ?? null} />
                </td>
                <td className="num px-2 text-right">{s?.avgDailyVolume == null ? "—" : formatDecimal(s.avgDailyVolume)}</td>
                <td className="num px-2 text-right">{s?.volatility == null ? "—" : formatPercent(s.volatility)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OrderbookPanel({ detail, quality }: { detail: ItemDetailResponse; quality: number }) {
  const [city, setCity] = useState<City>("Martlock");
  const now = useNow();
  if (!isPart(detail.orderbook)) return <ErrorState error={new Error(detail.orderbook.error)} />;
  const entry = detail.orderbook.entries.find((e) => e.quality === quality && cityOf(e.city) === city);
  const quote = isPart(detail.prices) ? detail.prices.rows.find((q) => q.quality === quality && q.city === city) : undefined;
  const side = (levels: OrderbookLevel[], tone: string, latestQuoteAt: number | null) =>
    levels.length === 0 ? (
      <p className="px-3 py-4 text-xs text-muted-foreground">No data</p>
    ) : (
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-[11px] text-muted-foreground uppercase">
            <th className="px-3 py-1 text-right font-medium">Price</th>
            <th className="px-3 text-right font-medium">Qty</th>
            <th className="px-3 text-right font-medium">Seen</th>
          </tr>
        </thead>
        <tbody>
          {levels.slice(0, 10).map((l) => {
            const superseded = isLevelSuperseded(l, latestQuoteAt);
            return (
            <tr
              key={`${l.price}-${l.updated_at}`}
              className={cn("border-t border-border/50", superseded && "opacity-40")}
              title={superseded ? "Seen before a newer price observation — probably filled or cancelled." : undefined}
            >
              <td className={cn("num px-3 py-1 text-right", tone, superseded && "line-through")}>{formatSilver(l.price)}</td>
              <td className="num px-3 text-right">{formatSilver(l.amount)}</td>
              <td className="num px-3 text-right text-muted-foreground">{formatAge(ageFrom(parseApiDate(l.updated_at), now))}</td>
            </tr>
            );
          })}
        </tbody>
      </table>
    );
  return (
    <div>
      <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
        {ROYAL_CITIES.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={c === city}
            onClick={() => setCity(c)}
            className={cn(
              "h-7 rounded-md border px-2 text-xs",
              c === city ? "border-primary/60 bg-primary/15 text-primary" : "border-input text-muted-foreground hover:text-foreground",
            )}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="grid sm:grid-cols-2 sm:divide-x sm:divide-border">
        <div>
          <p className="px-3 pt-2 text-xs font-medium">Sell Orders (Instant Buy)</p>
          {side(entry?.sell ?? [], "text-loss", quote?.sellMinAt ?? null)}
        </div>
        <div>
          <p className="px-3 pt-2 text-xs font-medium">Buy Orders (Instant Sell)</p>
          {side(entry?.buy ?? [], "text-profit", quote?.buyMaxAt ?? null)}
        </div>
      </div>
      <p className="px-3 py-2 text-[11px] text-muted-foreground">
        Aggregated per price level; only orders seen by player clients. Struck-through levels were seen before a newer price observation
        and are probably gone; they are left out of the depth calculation.
      </p>
    </div>
  );
}

function RiskNotes({ quotes, stats, maxAge, inUniverse }: { quotes: Quote[]; stats: Map<City, VolumeStats>; maxAge: number; inUniverse: boolean }) {
  const now = useNow();
  const notes: string[] = [];
  const missing = ROYAL_CITIES.filter((c) => !quotes.some((q) => q.city === c));
  if (missing.length) notes.push(`Cities without price data: ${missing.join(", ")}.`);
  const stale = quotes.filter((q) => {
    const ages = [ageFrom(q.sellMinAt, now), ageFrom(q.buyMaxAt, now)].filter((a): a is number => a !== null);
    return ages.length > 0 && Math.min(...ages) > maxAge;
  });
  if (stale.length) notes.push(`Stale price (>${formatAge(maxAge)}): ${stale.map((q) => q.city).join(", ")}.`);
  const noVolume = ROYAL_CITIES.filter((c) => !stats.get(c) || stats.get(c)?.avgDailyVolume == null);
  if (noVolume.length) notes.push(`Cities without sales history in the last 7 days: ${noVolume.join(", ")} — liquidity unknown.`);
  const volatile = ROYAL_CITIES.filter((c) => (stats.get(c)?.volatility ?? 0) > 0.2);
  if (volatile.length) notes.push(`Volatile price (20%+ coefficient of variation): ${volatile.join(", ")}.`);
  const thin = ROYAL_CITIES.filter((c) => {
    const v = stats.get(c)?.avgDailyVolume;
    return v != null && v < 5;
  });
  if (thin.length) notes.push(`Low volume (<5/day): ${thin.join(", ")} — orders may wait a long time.`);
  if (!inUniverse) notes.push("This item is not in the automatic scan universe, so it does not appear in the opportunity tables.");
  if (notes.length === 0) notes.push("No obvious data risk found. Prices are still collected from player clients and may change.");
  return (
    <ul className="list-disc space-y-1 py-3 pr-3 pl-7 text-xs text-muted-foreground">
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}

export function ItemDetailView() {
  const params = useParams<{ id: string }>();
  const itemId = decodeURIComponent(params.id);
  const { settings, hydrated } = useSettings();
  const now = useNow();
  const [quality, setQuality] = useState(1);

  const detailQuery = useQuery({
    queryKey: ["item", settings.server, itemId],
    queryFn: ({ signal }) => fetchItemDetail(itemId, settings.server, signal),
    enabled: hydrated,
    staleTime: 60_000,
  });
  const oppQuery = useOpportunities("all", { ...DEFAULT_FILTERS, itemId }, 50);

  const detail = detailQuery.data;
  const quotes = useMemo(
    () => (detail && isPart(detail.prices) ? detail.prices.rows.filter((q) => q.quality === quality) : []),
    [detail, quality],
  );
  const stats = useMemo(() => {
    const m = new Map<City, VolumeStats>();
    if (!detail || !isPart(detail.history)) return m;
    // Window relative to when the history was fetched keeps this pure and consistent with the server.
    const now = detail.history.fetchedAt;
    for (const s of detail.history.series) {
      const city = cityOf(s.location);
      if (city && s.quality === quality) m.set(city, computeVolumeStats(s.data, now));
    }
    return m;
  }, [detail, quality]);

  if (detailQuery.isError) {
    return (
      <div className="p-4">
        <Panel>
          <ErrorState error={detailQuery.error} onRetry={() => detailQuery.refetch()} />
        </Panel>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="p-4">
        <TableSkeleton rows={10} />
      </div>
    );
  }

  const { item } = detail;
  const qualities = Array.from({ length: item.maxQuality }, (_, i) => i + 1);
  const opps = oppQuery.data;

  return (
    <div className="pb-4">
      <PageHeader
        title={item.nameEn}
        description={
          <span className="flex flex-wrap items-center gap-x-2">
            <span className="num">{item.id}</span>
            <TierBadge tier={item.tier} enchant={item.enchant} />
            <span>{categoryLabel(item.category)}</span>
            {item.weight > 0 && <span className="num">{formatDecimal(item.weight)} kg</span>}
          </span>
        }
        actions={<ItemIcon itemId={item.id} quality={quality} size={56} />}
      />
      <div className="space-y-3 px-3 lg:px-4">
        {qualities.length > 1 && (
          <div className="flex flex-wrap items-center gap-1">
            <span lang="en" className="mr-1 text-[11px] tracking-wide text-muted-foreground uppercase">Quality</span>
            {qualities.map((q) => (
              <button
                key={q}
                type="button"
                aria-pressed={q === quality}
                onClick={() => setQuality(q)}
                className={cn(
                  "h-7 rounded-md border px-2 text-xs",
                  q === quality ? "border-primary/60 bg-primary/15 text-primary" : "border-input text-muted-foreground hover:text-foreground",
                )}
              >
                {QUALITY_LABELS[q]}
              </button>
            ))}
          </div>
        )}

        <Panel
          title="Current prices by city"
          actions={
            isPart(detail.prices) && (
              <span className="text-[11px] text-muted-foreground">fetched {formatAge(ageFrom(detail.prices.fetchedAt, now))} ago</span>
            )
          }
        >
          {isPart(detail.prices) ? (
            <PriceMatrix quotes={quotes} stats={stats} maxAge={settings.maxDataAgeMinutes} />
          ) : (
            <ErrorState error={new Error(detail.prices.error)} onRetry={() => detailQuery.refetch()} />
          )}
        </Panel>

        <Panel title="Price and volume history (30 days)">
          {isPart(detail.history) ? (
            <HistoryCharts series={detail.history.series} quality={quality} />
          ) : (
            <ErrorState error={new Error(detail.history.error)} />
          )}
        </Panel>

        <div className="grid gap-3 xl:grid-cols-[1fr_22rem]">
          <Panel title="Order Book">
            <OrderbookPanel detail={detail} quality={quality} />
          </Panel>
          <Panel title="Risks">
            <RiskNotes quotes={quotes} stats={stats} maxAge={settings.maxDataAgeMinutes} inUniverse={detail.inScanUniverse} />
          </Panel>
        </div>

        <Panel title="Opportunities for this item (all Qualities, all cities)">
          {oppQuery.isError && !opps ? (
            <ErrorState error={oppQuery.error} onRetry={() => oppQuery.refetch()} />
          ) : !opps ? (
            <TableSkeleton rows={4} />
          ) : opps.flips.items.length + opps.trades.items.length === 0 ? (
            <EmptyState title="No current profitable opportunities">
              {detail.inScanUniverse ? "No opportunity passes the ROI and data-age thresholds from Settings." : "This item is not in the scan universe."}
            </EmptyState>
          ) : (
            <div className="divide-y divide-border">
              {opps.flips.items.length > 0 && (
                <OpportunityTable data={opps.flips.items} variant="flip" maxDataAge={settings.maxDataAgeMinutes} pageSize={10} />
              )}
              {opps.trades.items.length > 0 && (
                <OpportunityTable data={opps.trades.items} variant="trade" maxDataAge={settings.maxDataAgeMinutes} pageSize={10} />
              )}
            </div>
          )}
        </Panel>
        <Disclaimer />
      </div>
    </div>
  );
}
