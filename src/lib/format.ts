const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const pctFmt = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1, minimumFractionDigits: 1 });
const decFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export function formatSilver(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  // `|| 0` turns -0 (e.g. a zero cost shown as a deduction) into 0.
  return intFmt.format(Math.round(value) || 0);
}

/** 1,250,000 → "1.25M", 85,400 → "85.4K" */
export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${decFmt.format(value / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value / 1_000_000)}M`;
  if (abs >= 10_000) return `${decFmt.format(value / 1_000)}K`;
  return intFmt.format(Math.round(value));
}

export function formatPercent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  return pctFmt.format(ratio);
}

export function formatDecimal(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return decFmt.format(value);
}

export function formatAge(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "—";
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)} h${minutes % 60 >= 1 ? ` ${Math.round(minutes % 60)} min` : ""}`;
  return `${decFmt.format(hours / 24)} d`;
}

/** Minutes between epochMs and now. `now` comes from useNow() in components (null before hydration). */
export function ageFrom(epochMs: number | null | undefined, now: number | null): number | null {
  if (!epochMs || now === null) return null;
  return Math.max(0, (now - epochMs) / 60_000);
}

export function formatDateTime(epochMs: number | null | undefined): string {
  if (!epochMs) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "short" }).format(epochMs);
}

/** Albion shorthand: T5 enchant 1 → "5.1" */
export function tierLabel(tier: number, enchant: number): string {
  return `${tier}.${enchant}`;
}
