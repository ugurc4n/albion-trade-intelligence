"use client";

import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { QUALITY_LABELS } from "@/lib/albion/constants";
import { formatAge } from "@/lib/format";
import { SCENARIO_LABELS, type ScenarioId } from "@/lib/profit/engine";
import type { Confidence, OpportunityFlag, RiskLevel } from "@/lib/scanner/types";
import { cn } from "@/lib/utils";

export function Pill({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[11px] leading-none font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function WithTip({ tip, children }: { tip: ReactNode; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex cursor-help" />}>{children}</TooltipTrigger>
      <TooltipContent className="max-w-72 text-left leading-snug">{tip}</TooltipContent>
    </Tooltip>
  );
}

export function FreshnessBadge({ minutes, maxMinutes }: { minutes: number | null; maxMinutes: number }) {
  if (minutes === null) return <Pill className="border-border text-muted-foreground">No data</Pill>;
  const tone =
    minutes > maxMinutes
      ? "border-transparent bg-rose-500/15 text-rose-300"
      : minutes > maxMinutes / 2
        ? "border-transparent bg-amber-400/12 text-amber-300"
        : "border-transparent bg-emerald-400/12 text-emerald-300";
  return (
    <WithTip tip={`The oldest price used was seen by a player client ${formatAge(minutes)} ago. Limit: ${formatAge(maxMinutes)}.`}>
      <Pill className={cn("num", tone)}>{formatAge(minutes)}</Pill>
    </WithTip>
  );
}

const RISK: Record<RiskLevel, { label: string; className: string }> = {
  low: { label: "Low", className: "border-transparent bg-emerald-400/15 text-emerald-300" },
  medium: { label: "Medium", className: "border-transparent bg-amber-400/15 text-amber-300" },
  high: { label: "High", className: "border-transparent bg-rose-500/18 text-rose-300" },
};

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  return <Pill className={RISK[risk].className}>{RISK[risk].label}</Pill>;
}

const CONF: Record<Confidence, { label: string; className: string }> = {
  high: { label: "High", className: "text-foreground" },
  medium: { label: "Medium", className: "text-muted-foreground" },
  low: { label: "Low", className: "text-muted-foreground/70" },
};

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <WithTip tip="Confidence: based on whether volume data exists, how fresh the prices are and how consistent they are. Without volume data it is at most 'Low'.">
      <span className={cn("text-xs", CONF[confidence].className)}>{CONF[confidence].label}</span>
    </WithTip>
  );
}

export const FLAG_INFO: Record<OpportunityFlag, { label: string; tip: string }> = {
  no_volume: { label: "No volume", tip: "No sales observed in the last 7 days. Liquidity is unknown; the suggested quantity is capped at 10." },
  low_volume: { label: "Low volume", tip: "Fewer than 5 sales a day observed. Orders may take a long time to fill." },
  volatile: { label: "Volatile", tip: "The coefficient of variation of daily average prices is above 20%." },
  price_outlier: { label: "Outlier", tip: "The price used deviates strongly from the 7-day average (may be a troll or stale order)." },
  extreme_roi: { label: "Extreme ROI", tip: "ROI above 150%. Usually caused by stale or mistaken orders." },
  stale: { label: "Stale data", tip: "One of the prices used is older than the data-age limit. Not a current opportunity." },
  budget_exceeds: { label: "Over budget", tip: "A single unit costs more than the trade budget." },
};

export function FlagBadges({ flags }: { flags: OpportunityFlag[] }) {
  if (!flags.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {flags.map((f) => (
        <WithTip key={f} tip={FLAG_INFO[f].tip}>
          <Pill
            className={cn(
              f === "stale" || f === "price_outlier" || f === "extreme_roi"
                ? "border-transparent bg-rose-500/15 text-rose-300"
                : "border-transparent bg-amber-400/12 text-amber-300",
            )}
          >
            {FLAG_INFO[f].label}
          </Pill>
        </WithTip>
      ))}
    </span>
  );
}

export function ScenarioBadge({ scenario }: { scenario: ScenarioId }) {
  return (
    <WithTip tip={SCENARIO_LABELS[scenario]}>
      <Pill className="border-transparent bg-sky-400/12 text-sky-300">{SCENARIO_LABELS[scenario]}</Pill>
    </WithTip>
  );
}

export function TierBadge({ tier, enchant }: { tier: number; enchant: number }) {
  const enchantTone = ["", "text-[oklch(0.75_0.15_150)]", "text-[oklch(0.72_0.13_240)]", "text-[oklch(0.72_0.15_310)]", "text-[oklch(0.8_0.14_80)]"];
  return (
    <span className="num text-[11px] text-muted-foreground">
      T{tier}
      <span className={enchantTone[enchant] ?? ""}>.{enchant}</span>
    </span>
  );
}

export function QualityLabel({ quality }: { quality: number }) {
  return <span className="text-[11px] text-muted-foreground">{QUALITY_LABELS[quality] ?? `Q${quality}`}</span>;
}
