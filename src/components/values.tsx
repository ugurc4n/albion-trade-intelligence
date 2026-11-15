import { formatCompact, formatPercent, formatSilver } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Silver({ value, compact, className }: { value: number | null | undefined; compact?: boolean; className?: string }) {
  return <span className={cn("num", className)}>{compact ? formatCompact(value) : formatSilver(value)}</span>;
}

/** Signed silver amount colored by sign. */
export function ProfitValue({ value, compact, className }: { value: number | null | undefined; compact?: boolean; className?: string }) {
  const tone = value === null || value === undefined ? "" : value > 0 ? "text-profit" : value < 0 ? "text-loss" : "";
  const sign = value && value > 0 ? "+" : "";
  return (
    <span className={cn("num", tone, className)}>
      {value === null || value === undefined ? "—" : `${sign}${compact ? formatCompact(value) : formatSilver(value)}`}
    </span>
  );
}

export function RoiValue({ value, className }: { value: number | null | undefined; className?: string }) {
  const tone = value === null || value === undefined ? "" : value > 0 ? "text-profit" : value < 0 ? "text-loss" : "";
  return <span className={cn("num", tone, className)}>{formatPercent(value)}</span>;
}
