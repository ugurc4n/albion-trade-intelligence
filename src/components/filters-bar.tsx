"use client";

import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-settings";
import { ROYAL_CITIES, SERVERS, SERVER_IDS, type ServerId } from "@/lib/albion/constants";
import { CATEGORY_LABELS } from "@/lib/catalog/types";
import type { ScenarioId } from "@/lib/profit/engine";
import type { Filters } from "@/lib/settings/schema";
import type { RiskLevel } from "@/lib/scanner/types";
import { cn } from "@/lib/utils";

type Variant = "flip" | "trade" | "basket";

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{children}</span>;
}

export function NativeSelect({
  value,
  onChange,
  children,
  label,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-8 rounded-md border border-input bg-transparent px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 [&>option]:bg-popover",
        className,
      )}
    >
      {children}
    </select>
  );
}

export function Chips<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T[];
  onChange: (v: T[]) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={label}>
      {options.map((o) => {
        const active = value.includes(o.value);
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={cn(
              "h-7 rounded-md border px-2 text-xs transition-colors",
              active ? "border-primary/60 bg-primary/15 text-primary" : "border-input text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Numeric input that commits on blur / Enter, so typing does not refetch on every keystroke. */
function NumberField({
  value,
  onCommit,
  placeholder,
  label,
  suffix,
  scale = 1,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  placeholder?: string;
  label: string;
  suffix?: string;
  scale?: number;
}) {
  const external = value === null ? "" : String(Math.round(value * scale * 100) / 100);
  const [text, setText] = useState(external);
  const [lastExternal, setLastExternal] = useState(external);
  if (external !== lastExternal) {
    setLastExternal(external);
    setText(external);
  }
  const commit = () => {
    const trimmed = text.trim().replace(/\./g, "").replace(",", ".");
    if (trimmed === "") return onCommit(null);
    const n = Number(trimmed);
    if (Number.isFinite(n)) onCommit(n / scale);
    else setText(external);
  };
  return (
    <label className="flex flex-col gap-1">
      <FieldLabel>{label}</FieldLabel>
      <div className="relative">
        <Input
          inputMode="decimal"
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className="num h-8 w-28 pr-7 text-[13px]"
        />
        {suffix && <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </label>
  );
}

const TIERS = [4, 5, 6, 7, 8].map((t) => ({ value: t, label: `T${t}` }));
const ENCHANTS = [0, 1, 2, 3, 4].map((e) => ({ value: e, label: `.${e}` }));
const QUALITIES = [
  { value: 1, label: "Normal" },
  { value: 2, label: "İyi" },
  { value: 3, label: "Seçkin" },
  { value: 4, label: "Mükemmel" },
  { value: 5, label: "Başyapıt" },
];
const CATEGORIES = ["crafting", "weapons", "armors", "head", "shoes", "offhands", "capes", "bags", "consumables", "mounts"].map((c) => ({
  value: c,
  label: CATEGORY_LABELS[c] ?? c,
}));
const SCENARIOS: { value: ScenarioId; label: string }[] = [
  { value: "instant-order", label: "Anında → Emir" },
  { value: "order-order", label: "Emir → Emir" },
  { value: "order-instant", label: "Emir → Anında" },
  { value: "instant-instant", label: "Anında → Anında" },
];
const RISKS: { value: RiskLevel; label: string }[] = [
  { value: "low", label: "Düşük" },
  { value: "medium", label: "Orta" },
  { value: "high", label: "Yüksek" },
];

export function FiltersBar({
  filters,
  onChange,
  onReset,
  variant,
}: {
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  onReset: () => void;
  variant: Variant;
}) {
  const { settings, update } = useSettings();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(filters.search);

  useEffect(() => {
    if (search === filters.search) return;
    const id = setTimeout(() => onChange({ search }), 350);
    return () => clearTimeout(id);
  }, [search, filters.search, onChange]);

  const activeCount =
    filters.tiers.length +
    filters.enchants.length +
    filters.categories.length +
    filters.qualities.length +
    filters.scenarios.length +
    filters.risks.length +
    [filters.minRoi, filters.minProfit, filters.maxInvestment, filters.maxDataAgeMinutes].filter((v) => v !== null).length;

  return (
    <div className="border-b border-border bg-surface">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2 px-3 py-2.5">
        <label className="relative min-w-48 flex-1 sm:max-w-72">
          <span className="sr-only">Ürün ara</span>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ürün ara (isim / ID)"
            className="h-8 pl-8 text-[13px]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <FieldLabel>Sunucu</FieldLabel>
          <NativeSelect label="Sunucu" value={settings.server} onChange={(v) => update({ server: v as ServerId })}>
            {SERVER_IDS.map((s) => (
              <option key={s} value={s}>
                {SERVERS[s].label}
              </option>
            ))}
          </NativeSelect>
        </label>

        <label className="flex flex-col gap-1">
          <FieldLabel>{variant === "flip" ? "Şehir" : "Alış şehri"}</FieldLabel>
          <NativeSelect label="Alış şehri" value={filters.buyCity} onChange={(v) => onChange({ buyCity: v as Filters["buyCity"] })}>
            <option value="all">Tümü</option>
            {ROYAL_CITIES.map((c) => (
              <option key={c} value={c}>
                {c}
                {c === settings.homeCity ? " (ana)" : ""}
              </option>
            ))}
          </NativeSelect>
        </label>

        {variant !== "flip" && (
          <label className="flex flex-col gap-1">
            <FieldLabel>Satış şehri</FieldLabel>
            <NativeSelect label="Satış şehri" value={filters.sellCity} onChange={(v) => onChange({ sellCity: v as Filters["sellCity"] })}>
              <option value="all">Tümü</option>
              {ROYAL_CITIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}

        <div className="flex h-8 items-center gap-2 self-end">
          <Switch id="premium" checked={settings.premium} onCheckedChange={(v) => update({ premium: v })} />
          <label htmlFor="premium" className="text-xs">
            Premium
          </label>
        </div>

        <div className="ml-auto flex items-center gap-2 self-end">
          <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            <SlidersHorizontal /> Filtreler{activeCount > 0 && <span className="num text-primary">({activeCount})</span>}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              onReset();
            }}
          >
            <RotateCcw /> Sıfırla
          </Button>
        </div>
      </div>

      {open && (
        <div className="grid gap-3 border-t border-border/70 px-3 py-3 lg:grid-cols-[auto_auto_1fr]">
          <div className="flex flex-col gap-1">
            <FieldLabel>Tier</FieldLabel>
            <Chips label="Tier" options={TIERS} value={filters.tiers} onChange={(tiers) => onChange({ tiers })} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>Enchant</FieldLabel>
            <Chips label="Enchant" options={ENCHANTS} value={filters.enchants} onChange={(enchants) => onChange({ enchants })} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>Kalite</FieldLabel>
            <Chips label="Kalite" options={QUALITIES} value={filters.qualities} onChange={(qualities) => onChange({ qualities })} />
          </div>
          <div className="flex flex-col gap-1 lg:col-span-3">
            <FieldLabel>Kategori</FieldLabel>
            <Chips label="Kategori" options={CATEGORIES} value={filters.categories} onChange={(categories) => onChange({ categories })} />
          </div>
          {variant !== "flip" && (
            <div className="flex flex-col gap-1 lg:col-span-2">
              <FieldLabel>Senaryo</FieldLabel>
              <Chips label="Senaryo" options={SCENARIOS} value={filters.scenarios} onChange={(scenarios) => onChange({ scenarios })} />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <FieldLabel>Risk</FieldLabel>
            <Chips label="Risk" options={RISKS} value={filters.risks} onChange={(risks) => onChange({ risks })} />
          </div>
          <div className="flex flex-wrap items-end gap-3 lg:col-span-3">
            <NumberField
              label="Min. ROI"
              suffix="%"
              scale={100}
              value={filters.minRoi}
              placeholder={String(Math.round(settings.minRoi * 100))}
              onCommit={(v) => onChange({ minRoi: v })}
            />
            <NumberField label="Min. net kâr/adet" value={filters.minProfit} placeholder="—" onCommit={(v) => onChange({ minProfit: v })} />
            <NumberField label="Maks. yatırım" value={filters.maxInvestment} placeholder="—" onCommit={(v) => onChange({ maxInvestment: v })} />
            <NumberField
              label="Maks. veri yaşı"
              suffix="dk"
              value={filters.maxDataAgeMinutes}
              placeholder={String(settings.maxDataAgeMinutes)}
              onCommit={(v) => onChange({ maxDataAgeMinutes: v === null ? null : Math.max(5, Math.round(v)) })}
            />
            <div className="flex h-8 items-center gap-2">
              <Switch id="stale" checked={filters.includeStale} onCheckedChange={(v) => onChange({ includeStale: v })} />
              <label htmlFor="stale" className="text-xs">
                Eski veriyi göster
              </label>
            </div>
            <div className="flex h-8 items-center gap-2">
              <Switch id="loss" checked={filters.includeUnprofitable} onCheckedChange={(v) => onChange({ includeUnprofitable: v })} />
              <label htmlFor="loss" className="text-xs">
                Kârsızları göster
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
