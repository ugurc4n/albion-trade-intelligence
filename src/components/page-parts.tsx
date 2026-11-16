"use client";

import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { WithTip } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import type { OpportunitiesResponse } from "@/lib/opportunities";
import { ageFrom, formatAge, formatSilver } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SECTIONS, type SectionKey } from "./sections";
import { TONE_CYCLE, TONES, type Tone } from "./tone";

export function PageHeader({
  title,
  description,
  actions,
  section,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Gives the header the section's colour and icon. */
  section?: SectionKey;
}) {
  const meta = section ? SECTIONS[section] : null;
  const Icon = meta?.icon;
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 px-3 pt-5 pb-4 lg:px-4">
      <div className="flex min-w-0 items-center gap-3">
        {meta && Icon && (
          <span
            className={cn(
              "chamfer grid size-10 shrink-0 place-items-center",
              TONES[meta.tone].solid,
            )}
          >
            <Icon className="size-5" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-[22px] leading-tight font-semibold">{title}</h1>
          {description && <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("overflow-hidden rounded-lg border border-border bg-card", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-border bg-white/[0.02] px-3.5 py-2.5">
          <h2 className="text-[14px] font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

/** Freshness of our snapshot (when we fetched) and coverage (how many batches loaded). */
export function DataStatus({
  meta,
  isFetching,
  onRefresh,
}: {
  meta?: OpportunitiesResponse["meta"];
  isFetching: boolean;
  onRefresh?: () => void;
}) {
  const now = useNow();
  if (!meta) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Scanning the market… (first load ~5–15 s)
      </div>
    );
  }
  const fetchedAge = ageFrom(meta.prices.oldestFetchAt, now);
  const partial = meta.prices.failed > 0 || meta.history.failed > 0;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <WithTip
        tip={`Prices were fetched from the Albion Data API ${formatAge(fetchedAge)} ago and are cached for 5 min. This is not when players saw the order — see the "Data age" column on each row.`}
      >
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", partial ? "bg-warn" : "bg-profit")} aria-hidden />
          Fetched <span className="num text-foreground">{formatAge(fetchedAge)}</span> ago
        </span>
      </WithTip>
      <span>
        Price batches{" "}
        <span className="num text-foreground">
          {meta.prices.loaded}/{meta.prices.total}
        </span>
      </span>
      <span>
        Volume batches{" "}
        <span className="num text-foreground">
          {meta.history.loaded}/{meta.history.total}
        </span>
      </span>
      <span>
        <span className="num text-foreground">{formatSilver(meta.universeSize)}</span> items ·{" "}
        <span className="num text-foreground">{formatSilver(meta.quoteCount)}</span> price points
      </span>
      {meta.errors.length > 0 && (
        <WithTip tip={meta.errors.join(" · ")}>
          <span className="inline-flex items-center gap-1 text-warn">
            <AlertTriangle className="size-3.5" /> {meta.errors.length} {meta.errors.length === 1 ? "warning" : "warnings"}
          </span>
        </WithTip>
      )}
      {onRefresh && (
        <Button variant="ghost" size="xs" onClick={onRefresh} disabled={isFetching} className="text-muted-foreground">
          <RefreshCw className={cn(isFetching && "animate-spin")} /> Refresh
        </Button>
      )}
    </div>
  );
}

export function KpiStrip({ items }: { items: { label: string; value: ReactNode; sub?: ReactNode; tip?: string; tone?: Tone }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
      {items.map((k, i) => {
        const t = TONES[k.tone ?? TONE_CYCLE[i % TONE_CYCLE.length]];
        return (
          <div key={k.label} className={cn("relative overflow-hidden rounded-lg px-3.5 py-3 ring-1", t.soft, t.ring)}>
            <span className={cn("absolute inset-y-0 left-0 w-[3px]", t.bar)} aria-hidden />
            <div className={cn("text-[11px] font-semibold tracking-[0.08em] uppercase", t.text)}>
              {k.tip ? <WithTip tip={k.tip}>{k.label}</WithTip> : k.label}
            </div>
            <div className="mt-1 font-display text-[22px] leading-tight font-semibold">{k.value}</div>
            {k.sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{k.sub}</div>}
          </div>
        );
      })}
    </div>
  );
}

export function Disclaimer({ className }: { className?: string }) {
  return (
    <p className={cn("text-[11px] leading-relaxed text-muted-foreground/80", className)}>
      Profits shown are estimates: prices are collected from player clients and may be delayed or incomplete, and orders are not
      guaranteed to fill. Sales Tax and Setup Fee use the assumptions from Settings.
    </p>
  );
}
