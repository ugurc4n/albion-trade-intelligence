"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Package } from "lucide-react";
import { useState } from "react";
import { TierBadge } from "@/components/badges";
import { ItemIcon } from "@/components/item-icon";
import { Panel } from "@/components/page-parts";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/use-settings";
import { damageApi } from "@/lib/damage/client-api";
import { lootSourceLabel } from "@/lib/damage/presentation";
import type { LootEntry, SessionRecord } from "@/lib/damage/types";
import { formatCompact, formatSilver } from "@/lib/format";
import { cn } from "@/lib/utils";

const COLLAPSED_ROWS = 10;

type LootRow = {
  key: string;
  by: string;
  item: LootEntry["item"];
  index: number;
  quantity: number;
  from: string[];
  lastAt: number;
};

/** One row per looter and item; most valuable first. */
function groupLoot(entries: LootEntry[]): LootRow[] {
  const rows = new Map<string, LootRow>();
  for (const e of entries) {
    const key = `${e.by}|${e.item?.id ?? `#${e.index}`}`;
    const row = rows.get(key) ?? { key, by: e.by, item: e.item, index: e.index, quantity: 0, from: [], lastAt: 0 };
    row.quantity += e.quantity;
    row.lastAt = Math.max(row.lastAt, e.at);
    const source = lootSourceLabel(e.from);
    if (!row.from.includes(source)) row.from.push(source);
    rows.set(key, row);
  }
  return [...rows.values()];
}

/** Items picked up in a session, with an estimated market value; follows the table's Party only filter. */
export function LootPanel({ session, partyOnly, selfName }: { session: SessionRecord; partyOnly: boolean; selfName: string | null }) {
  const { settings } = useSettings();
  const [showAll, setShowAll] = useState(false);
  const scope = partyOnly && session.party ? new Set(session.party.map((n) => n.toLowerCase())) : null;
  const entries = (session.loot ?? []).filter((e) => !scope || scope.has(e.by.toLowerCase()));
  const ids = [...new Set(entries.flatMap((e) => (e.item ? [e.item.id] : [])))].sort();

  const values = useQuery({
    queryKey: ["loot-values", settings.server, ids.join(",")],
    queryFn: ({ signal }) => damageApi.lootValues(settings.server, ids, signal),
    enabled: ids.length > 0,
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
  const unit = (row: LootRow) => (row.item ? values.data?.values[row.item.id] ?? null : null);
  const value = (row: LootRow) => (unit(row) ?? 0) * row.quantity;

  const rows = groupLoot(entries).sort((a, b) => value(b) - value(a) || b.lastAt - a.lastAt);
  const totalItems = rows.reduce((sum, r) => sum + r.quantity, 0);
  const totalValue = rows.reduce((sum, r) => sum + value(r), 0);
  const looters = new Map<string, { items: number; value: number }>();
  for (const r of rows) {
    const t = looters.get(r.by) ?? { items: 0, value: 0 };
    t.items += r.quantity;
    t.value += value(r);
    looters.set(r.by, t);
  }
  const shown = showAll ? rows : rows.slice(0, COLLAPSED_ROWS);
  const isSelf = (name: string) => !!selfName && name.toLowerCase() === selfName.toLowerCase();

  return (
    <Panel
      title={<span className="flex items-center gap-2"><Package className="size-4 text-muted-foreground" />Loot</span>}
      actions={rows.length > 0 && (
        <span className="text-xs text-muted-foreground">
          <span className="num text-foreground">{totalItems}</span> {totalItems === 1 ? "item" : "items"}
          {totalValue > 0 && <> · est. <span className="num text-amber-300">{formatCompact(totalValue)}</span> silver</>}
        </span>
      )}
    >
      {rows.length === 0 ? (
        <p className="px-3 py-4 text-xs text-muted-foreground">
          No items picked up yet{scope ? " by the party" : ""}. Items show up here as soon as someone loots them.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 border-b border-border px-3 py-2 text-xs">
            {[...looters].sort((a, b) => b[1].value - a[1].value || b[1].items - a[1].items).map(([name, t]) => (
              <span key={name} className="rounded-md border border-border px-2 py-1">
                <span className={cn("font-medium", isSelf(name) && "text-fuchsia-300")}>{name}</span>
                <span className="text-muted-foreground"> · {t.items} {t.items === 1 ? "item" : "items"}</span>
                {t.value > 0 && <span className="num text-amber-300"> · {formatCompact(t.value)}</span>}
              </span>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-medium">Item</th>
                  <th className="px-3 py-2 text-left font-medium">Looted by</th>
                  <th className="hidden px-3 py-2 text-left font-medium md:table-cell">From</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Est. value</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const price = unit(r);
                  return (
                    <tr key={r.key} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-1.5">
                        <div className="flex min-w-0 items-center gap-2">
                          {r.item ? <ItemIcon itemId={r.item.id} size={28} /> : <div className="size-7 shrink-0 rounded bg-muted" aria-hidden />}
                          <span lang="en" className="truncate">{r.item?.nameEn ?? `Unknown item #${r.index}`}</span>
                          {r.item && <TierBadge tier={r.item.tier} enchant={r.item.enchant} />}
                        </div>
                      </td>
                      <td className={cn("px-3 py-1.5", isSelf(r.by) && "text-fuchsia-300")}>{r.by}</td>
                      <td className="hidden max-w-56 truncate px-3 py-1.5 text-xs text-muted-foreground md:table-cell" title={r.from.join(", ")}>
                        {r.from.join(", ")}
                      </td>
                      <td className="num px-3 py-1.5 text-right">{r.quantity}</td>
                      <td className="num px-3 py-1.5 text-right" title={price !== null ? `${formatSilver(price)} each` : undefined}>
                        {price !== null ? formatSilver(price * r.quantity) : <span className="text-muted-foreground">{values.isPending && r.item ? "…" : "—"}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > COLLAPSED_ROWS && (
            <div className="border-t border-border px-3 py-2">
              <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show fewer" : `Show all ${rows.length} rows`}
              </Button>
            </div>
          )}
          <p className="border-t border-border px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            Estimated value: median of the Royal Cities&apos; lowest Sell Orders of the last week, at Normal quality (the loot
            message has no Quality). Items without a recent price show —.
            {values.isError && " Market prices could not be loaded right now."}
          </p>
        </>
      )}
    </Panel>
  );
}
