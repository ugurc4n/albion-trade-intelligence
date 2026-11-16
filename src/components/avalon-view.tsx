"use client";

import { Gem, Search, ShieldAlert, Skull, Trees, X } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { Pill } from "@/components/badges";
import { Chips, FieldLabel, NativeSelect } from "@/components/filters-bar";
import { PageHeader, Panel } from "@/components/page-parts";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEFAULT_AVALON_FILTERS, filterZones, totalChests, totalDungeons, type AvalonFilters } from "@/lib/avalon/query";
import {
  CHEST_GRADE_LABELS,
  CHEST_SIZE_LABELS,
  DUNGEON_KIND_LABELS,
  FACTION_LABELS,
  RESOURCE_LABELS,
  ZONE_TYPE_LABELS,
  zoneTypeLabel,
  type AvalonChest,
  type AvalonDungeon,
  type AvalonResource,
  type AvalonZone,
  type ChestGrade,
  type DungeonKind,
} from "@/lib/avalon/types";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 40;

const TIER_OPTIONS = [4, 6, 8].map((t) => ({ value: t, label: `T${t}` }));
const GRADE_OPTIONS: { value: ChestGrade; label: string }[] = [
  { value: "elite", label: "Elite Chest" },
  { value: "veteran", label: "Veteran Chest" },
];
const DUNGEON_OPTIONS: { value: DungeonKind; label: string }[] = [
  { value: "solo", label: "Solo" },
  { value: "group", label: "Group" },
  { value: "avalonian", label: "Avalonian (Elite)" },
];

const GRADE_TONE: Record<ChestGrade, string> = {
  elite: "border-transparent bg-amber-400/15 text-amber-300",
  veteran: "border-transparent bg-sky-400/12 text-sky-300",
  standard: "border-transparent bg-white/5 text-muted-foreground",
};

const DUNGEON_TONE: Record<DungeonKind, string> = {
  avalonian: "border-transparent bg-fuchsia-500/15 text-fuchsia-300",
  group: "border-transparent bg-violet-500/15 text-violet-300",
  solo: "border-transparent bg-white/5 text-muted-foreground",
};

function chestLabel(c: AvalonChest): string {
  const grade = c.grade === "standard" ? "" : ` ${CHEST_GRADE_LABELS[c.grade]}`;
  return `${CHEST_SIZE_LABELS[c.size]}${grade} T${c.tier}`;
}

function dungeonLabel(d: AvalonDungeon): string {
  return `${DUNGEON_KIND_LABELS[d.kind]} T${d.tier} · ${FACTION_LABELS[d.faction] ?? d.faction}`;
}

/** ORE T4×3, T5×2, T6×3 → "Ore T4–T6 (8)" */
function resourceSummary(resources: AvalonResource[]): { type: string; label: string; nodes: number }[] {
  const byType = new Map<string, AvalonResource[]>();
  for (const r of resources) byType.set(r.type, [...(byType.get(r.type) ?? []), r]);
  return [...byType].map(([type, list]) => {
    const tiers = list.map((r) => r.tier);
    const min = Math.min(...tiers);
    const max = Math.max(...tiers);
    return {
      type,
      label: `${RESOURCE_LABELS[type] ?? type} ${min === max ? `T${min}` : `T${min}–T${max}`}`,
      nodes: list.reduce((s, r) => s + r.count, 0),
    };
  });
}

function ZoneCard({ zone }: { zone: AvalonZone }) {
  const chestCount = totalChests(zone);
  const dungeonCount = totalDungeons(zone);
  const resources = resourceSummary(zone.resources);
  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3.5 transition-colors hover:border-emerald-300/30">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{zone.name}</h3>
          <p className="text-[11px] text-muted-foreground">
            <span className="num">{zone.id}</span> · {zoneTypeLabel(zone.type)}
          </p>
        </div>
        <Pill className="num border-transparent bg-emerald-400/15 text-emerald-300">T{zone.tier}</Pill>
      </header>

      <section className="space-y-1.5">
        <h4 lang="en" className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          <Gem className="size-3.5" aria-hidden /> Chests <span className="num normal-case">({chestCount})</span>
        </h4>
        {zone.chests.length === 0 ? (
          <p className="text-xs text-muted-foreground">No Chest spots</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {zone.chests.map((c) => (
              <Pill key={`${c.size}-${c.grade}-${c.tier}`} className={GRADE_TONE[c.grade]}>
                <span className="num">{c.count}×</span> {chestLabel(c)}
              </Pill>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-1.5">
        <h4 lang="en" className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          <Skull className="size-3.5" aria-hidden /> Dungeons <span className="num normal-case">({dungeonCount})</span>
        </h4>
        {zone.dungeons.length === 0 ? (
          <p className="text-xs text-muted-foreground">No Dungeon entrances</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {zone.dungeons.map((d) => (
              <Pill key={`${d.kind}-${d.tier}-${d.faction}`} className={DUNGEON_TONE[d.kind]}>
                {d.count > 1 && <span className="num">{d.count}×</span>} {dungeonLabel(d)}
              </Pill>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-1.5">
        <h4 lang="en" className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          <Trees className="size-3.5" aria-hidden /> Resources
        </h4>
        {resources.length === 0 ? (
          <p className="text-xs text-muted-foreground">No data</p>
        ) : (
          <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
            {resources.map((r) => (
              <li key={r.type} className="flex justify-between gap-2">
                <span>{r.label}</span>
                <span className="num text-muted-foreground">{r.nodes} {r.nodes === 1 ? "node" : "nodes"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}

export function AvalonView({ zones, generatedAt }: { zones: AvalonZone[]; generatedAt: string }) {
  const [filters, setFilters] = useState<AvalonFilters>(DEFAULT_AVALON_FILTERS);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const deferred = useDeferredValue(filters);
  const results = useMemo(() => filterZones(zones, deferred), [zones, deferred]);

  const typeOptions = useMemo(() => [...new Set(zones.map((z) => z.type))].sort(), [zones]);
  const update = (patch: Partial<AvalonFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setVisible(PAGE_SIZE);
  };
  const dirty =
    filters.query !== "" ||
    filters.tiers.length > 0 ||
    filters.types.length > 0 ||
    filters.chestGrades.length > 0 ||
    filters.dungeonKinds.length > 0;

  return (
    <div className="pb-8">
      <PageHeader section="avalon"
        title="Roads of Avalon"
        description="Type a Zone name to see its Chest spots, Dungeon entrances and Resource Node counts. Built from the game's static map files; no requests are sent to the Albion Data API."
      />

      <div className="space-y-3 px-3 lg:px-4">
        <div className="flex gap-2.5 rounded-lg border border-warn/30 bg-warn/5 p-3 text-xs leading-relaxed">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          <div className="space-y-1">
            <p>
              <span className="font-medium text-foreground">Roads of Avalon is a full-loot PvP area.</span>{" "}
              <span className="text-muted-foreground">
                Your profile is set up for safe trading; this page is for information only.
              </span>
            </p>
            <p className="text-muted-foreground">
              This is the Zone&apos;s fixed layout. The live state of Chests and <span className="text-foreground">Portal connections</span>
              {" "}are not shown here. Chest counts are possible spawn points, not Chests that can be opened right now.
            </p>
          </div>
        </div>

        <Panel>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3 p-3">
            <label className="flex min-w-60 flex-1 flex-col gap-1">
              <FieldLabel>Zone name</FieldLabel>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  autoFocus
                  value={filters.query}
                  onChange={(e) => update({ query: e.target.value })}
                  placeholder="e.g. Ouyos-Aoeuam"
                  className="h-8 pl-8 text-[13px]"
                  aria-label="Search Zone name"
                />
              </div>
            </label>
            <div className="flex flex-col gap-1">
              <FieldLabel lang="en">Tier</FieldLabel>
              <Chips label="Tier" options={TIER_OPTIONS} value={filters.tiers} onChange={(tiers) => update({ tiers })} />
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel lang="en">Chest</FieldLabel>
              <Chips label="Chest" options={GRADE_OPTIONS} value={filters.chestGrades} onChange={(chestGrades) => update({ chestGrades })} />
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel lang="en">Dungeon</FieldLabel>
              <Chips
                label="Dungeon"
                options={DUNGEON_OPTIONS}
                value={filters.dungeonKinds}
                onChange={(dungeonKinds) => update({ dungeonKinds })}
              />
            </div>
            <label className="flex flex-col gap-1">
              <FieldLabel>Zone type</FieldLabel>
              <NativeSelect
                label="Zone type"
                value={filters.types[0] ?? ""}
                onChange={(v) => update({ types: v ? [v] : [] })}
                className="w-44"
              >
                <option value="">All</option>
                {typeOptions.map((t) => (
                  <option key={t} value={t}>
                    {ZONE_TYPE_LABELS[t] ?? t}
                  </option>
                ))}
              </NativeSelect>
            </label>
            {dirty && (
              <Button variant="ghost" size="sm" onClick={() => update(DEFAULT_AVALON_FILTERS)}>
                <X /> Clear
              </Button>
            )}
          </div>
        </Panel>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            <span className="num text-foreground">{results.length}</span> / <span className="num">{zones.length}</span> Zone
          </span>
          <span>
            Source: ao-bin-dumps game files · generated <span className="num">{generatedAt.slice(0, 10)}</span>
          </span>
        </div>

        {results.length === 0 ? (
          <Panel>
            <EmptyState title="No data">
              {filters.query
                ? `There is no Roads of Avalon Zone named "${filters.query}". Check that you typed it as in the game (case and hyphens do not matter).`
                : "No Zones match the filters."}
            </EmptyState>
          </Panel>
        ) : (
          <>
            <div className={cn("grid gap-3 sm:grid-cols-2 2xl:grid-cols-3", deferred !== filters && "opacity-70")}>
              {results.slice(0, visible).map((z) => (
                <ZoneCard key={z.id} zone={z} />
              ))}
            </div>
            {results.length > visible && (
              <div className="flex justify-center pt-1">
                <Button variant="outline" size="sm" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                  Show more ({results.length - visible})
                </Button>
              </div>
            )}
          </>
        )}

        <p className="text-[11px] leading-relaxed text-muted-foreground/80">
          {DUNGEON_KIND_LABELS.solo}, {DUNGEON_KIND_LABELS.group} and {DUNGEON_KIND_LABELS.avalonian} entrances
          were verified against the Zone&apos;s map markers. Resource Node counts come from the game&apos;s distribution table;
          Nodes may be empty after gathering until they respawn.
        </p>
      </div>
    </div>
  );
}
