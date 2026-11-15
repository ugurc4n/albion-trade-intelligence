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
  if (minutes === null) return <Pill className="border-border text-muted-foreground">Veri yok</Pill>;
  const tone =
    minutes > maxMinutes
      ? "border-transparent bg-rose-500/15 text-rose-300"
      : minutes > maxMinutes / 2
        ? "border-transparent bg-amber-400/12 text-amber-300"
        : "border-transparent bg-emerald-400/12 text-emerald-300";
  return (
    <WithTip tip={`Kullanılan fiyatların en eskisi ${formatAge(minutes)} önce bir oyuncu istemcisi tarafından görüldü. Sınır: ${formatAge(maxMinutes)}.`}>
      <Pill className={cn("num", tone)}>{formatAge(minutes)}</Pill>
    </WithTip>
  );
}

const RISK: Record<RiskLevel, { label: string; className: string }> = {
  low: { label: "Düşük", className: "border-transparent bg-emerald-400/15 text-emerald-300" },
  medium: { label: "Orta", className: "border-transparent bg-amber-400/15 text-amber-300" },
  high: { label: "Yüksek", className: "border-transparent bg-rose-500/18 text-rose-300" },
};

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  return <Pill className={RISK[risk].className}>{RISK[risk].label}</Pill>;
}

const CONF: Record<Confidence, { label: string; className: string }> = {
  high: { label: "Yüksek", className: "text-foreground" },
  medium: { label: "Orta", className: "text-muted-foreground" },
  low: { label: "Düşük", className: "text-muted-foreground/70" },
};

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <WithTip tip="Güven: hacim verisinin varlığı, fiyatların güncelliği ve fiyat tutarlılığına göre belirlenir. Hacim verisi yoksa en fazla 'Düşük'.">
      <span className={cn("text-xs", CONF[confidence].className)}>{CONF[confidence].label}</span>
    </WithTip>
  );
}

export const FLAG_INFO: Record<OpportunityFlag, { label: string; tip: string }> = {
  no_volume: { label: "Hacim yok", tip: "Son 7 günde gözlemlenmiş satış verisi yok. Likidite bilinmiyor; önerilen adet en fazla 10." },
  low_volume: { label: "Düşük hacim", tip: "Günde 5'ten az satış gözlemlendi. Emirler uzun süre dolmayabilir." },
  volatile: { label: "Oynak", tip: "Günlük ortalama fiyatların değişim katsayısı %20'nin üzerinde." },
  price_outlier: { label: "Anomali", tip: "Kullanılan fiyat 7 günlük ortalamadan çok sapıyor (troll/eski emir olabilir)." },
  extreme_roi: { label: "Aşırı ROI", tip: "ROI %150'nin üzerinde. Genellikle eski veya hatalı emirlerden kaynaklanır." },
  stale: { label: "Eski veri", tip: "Kullanılan fiyatlardan biri veri yaşı sınırını aşıyor. Güncel fırsat değildir." },
  budget_exceeds: { label: "Bütçe üstü", tip: "Tek birimin maliyeti ticaret bütçesini aşıyor." },
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

const SCENARIO_SHORT: Record<ScenarioId, string> = {
  "instant-order": "Anında → Emir",
  "order-order": "Emir → Emir",
  "order-instant": "Emir → Anında",
  "instant-instant": "Anında → Anında",
};

export function ScenarioBadge({ scenario }: { scenario: ScenarioId }) {
  return (
    <WithTip tip={SCENARIO_LABELS[scenario]}>
      <Pill className="border-transparent bg-sky-400/12 text-sky-300">{SCENARIO_SHORT[scenario]}</Pill>
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
