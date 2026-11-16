"use client";

import {
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type PaginationState,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowRight, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import {
  ConfidenceBadge,
  FlagBadges,
  FreshnessBadge,
  QualityLabel,
  RiskBadge,
  ScenarioBadge,
  TierBadge,
  WithTip,
} from "@/components/badges";
import { ItemIcon } from "@/components/item-icon";
import { ProfitValue, RoiValue, Silver } from "@/components/values";
import { Button } from "@/components/ui/button";
import { formatAge, formatDecimal, formatSilver } from "@/lib/format";
import { SCENARIO_LABELS } from "@/lib/profit/engine";
import type { Opportunity } from "@/lib/scanner/types";
import { cn } from "@/lib/utils";

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});

const helper = createColumnHelper<typeof features, Opportunity>();

type Variant = "flip" | "trade";

function ItemCell({ o }: { o: Opportunity }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <ItemIcon itemId={o.itemId} quality={o.quality} size={30} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <Link
            href={`/item/${encodeURIComponent(o.itemId)}`}
            className="truncate text-[13px] font-medium hover:text-primary hover:underline"
            onClick={(e) => e.stopPropagation()}
            title={o.itemId}
          >
            {o.name}
          </Link>
        </div>
        <div className="flex items-center gap-1.5">
          <TierBadge tier={o.tier} enchant={o.enchant} />
          <QualityLabel quality={o.quality} />
        </div>
      </div>
    </div>
  );
}

function buildColumns(variant: Variant, maxAge: number) {
  const item = helper.accessor((o) => o.name, {
    id: "item",
    header: "Item",
    cell: (info) => <ItemCell o={info.row.original} />,
  });
  const route =
    variant === "flip"
      ? helper.accessor((o) => o.buyCity, { id: "city", header: "City", cell: (i) => <span className="text-xs">{i.getValue()}</span> })
      : helper.accessor((o) => `${o.buyCity}>${o.sellCity}`, {
          id: "route",
          header: "Route",
          cell: (i) => {
            const o = i.row.original;
            return (
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-xs whitespace-nowrap">
                  {o.buyCity} <ArrowRight className="size-3 text-muted-foreground" /> {o.sellCity}
                </div>
                <ScenarioBadge scenario={o.scenario} />
              </div>
            );
          },
        });

  const priceCols =
    variant === "flip"
      ? [
          helper.accessor((o) => o.sourceBuyMax, {
            id: "buyMax",
            header: "Highest Buy Order",
            cell: (i) => <Silver value={i.getValue()} className="text-muted-foreground" />,
          }),
          helper.accessor((o) => o.sourceSellMin, {
            id: "sellMin",
            header: "Lowest Sell Order",
            cell: (i) => <Silver value={i.getValue()} className="text-muted-foreground" />,
          }),
          helper.accessor((o) => o.profit.buyPrice, { id: "buyPrice", header: "Suggested buy", cell: (i) => <Silver value={i.getValue()} /> }),
          helper.accessor((o) => o.profit.sellPrice, { id: "sellPrice", header: "Suggested sell", cell: (i) => <Silver value={i.getValue()} /> }),
        ]
      : [
          helper.accessor((o) => o.profit.buyPrice, {
            id: "buyPrice",
            header: "Buy",
            cell: (i) => (
              <div className="leading-tight">
                <Silver value={i.getValue()} />
                <div className="text-[10px] text-muted-foreground">{i.row.original.buyMode === "instant" ? "Instant Buy" : "Buy Order"}</div>
              </div>
            ),
          }),
          helper.accessor((o) => o.profit.sellPrice, {
            id: "sellPrice",
            header: "Sell",
            cell: (i) => (
              <div className="leading-tight">
                <Silver value={i.getValue()} />
                <div className="text-[10px] text-muted-foreground">{i.row.original.sellMode === "instant" ? "Instant Sell" : "Sell Order"}</div>
              </div>
            ),
          }),
        ];

  return helper.columns([
    item,
    route,
    ...priceCols,
    helper.accessor((o) => o.profit.unitProfit, {
      id: "unitProfit",
      header: "Net profit / unit",
      cell: (i) => <ProfitValue value={i.getValue()} />,
    }),
    helper.accessor((o) => o.profit.roi, { id: "roi", header: "ROI", cell: (i) => <RoiValue value={i.getValue()} /> }),
    helper.accessor((o) => o.targetDailyVolume ?? -1, {
      id: "volume",
      header: "Volume/day",
      cell: (i) => {
        const v = i.row.original.targetDailyVolume;
        return v === null ? <span className="text-xs text-muted-foreground">none</span> : <span className="num">{formatDecimal(v)}</span>;
      },
    }),
    helper.accessor((o) => o.recommendedQty, { id: "qty", header: "Qty", cell: (i) => <span className="num">{formatSilver(i.getValue())}</span> }),
    helper.accessor((o) => o.requiredCapital, { id: "capital", header: "Capital", cell: (i) => <Silver value={i.getValue()} compact /> }),
    helper.accessor((o) => o.potentialProfit, {
      id: "potential",
      header: "Potential profit",
      cell: (i) => <ProfitValue value={i.getValue()} compact />,
    }),
    helper.accessor((o) => o.dataAgeMinutes, {
      id: "age",
      header: "Data age",
      cell: (i) => <FreshnessBadge minutes={i.getValue()} maxMinutes={maxAge} />,
    }),
    helper.accessor((o) => ({ low: 0, medium: 1, high: 2 })[o.risk], {
      id: "risk",
      header: "Risk",
      cell: (i) => (
        <div className="flex flex-col items-start gap-1">
          <RiskBadge risk={i.row.original.risk} />
          <FlagBadges flags={i.row.original.flags.filter((f) => f !== "stale")} />
        </div>
      ),
    }),
    helper.accessor((o) => ({ low: 0, medium: 1, high: 2 })[o.confidence], {
      id: "confidence",
      header: "Confidence",
      cell: (i) => <ConfidenceBadge confidence={i.row.original.confidence} />,
    }),
    helper.accessor((o) => o.score, {
      id: "score",
      header: "Score",
      cell: (i) => <span className="num font-medium text-primary">{formatDecimal(i.getValue())}</span>,
    }),
  ]);
}

const NUMERIC = new Set(["buyMax", "sellMin", "buyPrice", "sellPrice", "unitProfit", "roi", "volume", "qty", "capital", "potential", "score"]);
const DESKTOP_ONLY = new Set(["buyMax", "sellMin", "volume", "capital", "confidence"]);

function Breakdown({ o }: { o: Opportunity }) {
  const p = o.profit;
  const rows: [string, number, string?][] = [
    [o.buyMode === "instant" ? "Instant Buy price" : "Buy Order price", p.buyPrice],
    ["Buy Order Setup Fee", -p.buySetupFee, o.buyMode === "order" ? undefined : "none for Instant Buy"],
    [o.sellMode === "instant" ? "Instant Sell price" : "Sell Order price", p.sellPrice],
    ["Sales Tax", -p.salesTax],
    ["Sell Order Setup Fee", -p.sellSetupFee, o.sellMode === "order" ? undefined : "none for Instant Sell"],
    ["Relists (assumption)", -p.relistCost],
    ["Transport (assumption)", -p.transport],
  ];
  return (
    <div className="grid gap-4 px-3 py-3 text-xs md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div>
        <p className="mb-1.5 font-medium">{SCENARIO_LABELS[o.scenario]} — per unit</p>
        <dl className="divide-y divide-border/60">
          {rows.map(([label, value, note]) => (
            <div key={label} className="flex justify-between gap-4 py-1">
              <dt className="text-muted-foreground">
                {label}
                {note && <span className="ml-1 text-muted-foreground/60">({note})</span>}
              </dt>
              <dd className="num">{formatSilver(value)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-4 py-1 font-medium">
            <dt>Net profit / unit</dt>
            <dd>
              <ProfitValue value={p.unitProfit} />
            </dd>
          </div>
          <div className="flex justify-between gap-4 py-1">
            <dt className="text-muted-foreground">Break-even sell price</dt>
            <dd className="num">{formatSilver(Math.ceil(p.breakEvenSellPrice))}</dd>
          </div>
        </dl>
      </div>
      <div className="space-y-2 text-muted-foreground">
        <p>
          <span className="text-foreground">Market: </span>
          {o.buyCity}: lowest sell <Silver value={o.sourceSellMin} />, highest buy <Silver value={o.sourceBuyMax} />
          {o.kind === "trade" && (
            <>
              {" · "}
              {o.sellCity}: lowest sell <Silver value={o.targetSellMin} />, highest buy <Silver value={o.targetBuyMax} />
            </>
          )}
        </p>
        <p>
          <span className="text-foreground">Volume (7-day avg.): </span>
          {o.buyCity} {o.sourceDailyVolume === null ? "no data" : `${formatDecimal(o.sourceDailyVolume)}/day`}
          {o.kind === "trade" && ` · ${o.sellCity} ${o.targetDailyVolume === null ? "no data" : `${formatDecimal(o.targetDailyVolume)}/day`}`}
          {o.volatility !== null && ` · volatility ${formatDecimal(o.volatility * 100)}%`}
        </p>
        <p>
          <span className="text-foreground">Estimated wait: </span>
          {o.estHoldDays === null ? "unknown" : o.estHoldDays === 0 ? "instant (depth not guaranteed)" : `~${formatDecimal(o.estHoldDays)} days (assuming a market share)`}
          {o.weight > 0 && o.kind === "trade" && ` · weight ${formatDecimal(o.weight)} kg/unit, total ${formatDecimal(o.weight * o.recommendedQty)} kg`}
        </p>
        <p className="flex flex-wrap items-center gap-1">
          <FlagBadges flags={o.flags} />
        </p>
        <p className="text-[11px] text-muted-foreground/80">
          These are estimates: orders filling, prices holding and the shown depth being available are not guaranteed. Data seen {formatAge(o.dataAgeMinutes)} ago.
        </p>
        <Link href={`/item/${encodeURIComponent(o.itemId)}`} className="inline-flex items-center gap-1 text-primary hover:underline">
          Item details <ExternalLink className="size-3" />
        </Link>
      </div>
    </div>
  );
}

export function OpportunityTable({
  data,
  variant,
  maxDataAge,
  pageSize = 25,
  paginate = true,
  hideColumns = [],
}: {
  data: Opportunity[];
  variant: Variant;
  maxDataAge: number;
  pageSize?: number;
  paginate?: boolean;
  hideColumns?: string[];
}) {
  const columns = useMemo(() => {
    const hidden = new Set(hideColumns);
    return buildColumns(variant, maxDataAge).filter((c) => !hidden.has(c.id ?? ""));
  }, [variant, maxDataAge, hideColumns]);
  const [sorting, setSorting] = useState<SortingState>([{ id: "score", desc: true }]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: paginate ? pageSize : 1000 });
  const [expanded, setExpanded] = useState<string | null>(null);

  const table = useTable({
    features,
    columns,
    data,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getRowId: (row) => row.id,
    enableSortingRemoval: false,
    autoResetPageIndex: true,
  });

  const rows = table.getRowModel().rows;
  const colCount = columns.length;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-surface">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="border-b border-border">
                {group.headers.map((header) => {
                  const id = header.column.id;
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      className={cn(
                        "h-8 px-2 text-[11px] font-medium whitespace-nowrap text-muted-foreground uppercase tracking-wide",
                        NUMERIC.has(id) ? "text-right" : "text-left",
                        DESKTOP_ONLY.has(id) && "hidden xl:table-cell",
                      )}
                    >
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn("inline-flex items-center gap-1 hover:text-foreground", sorted && "text-foreground")}
                      >
                        <table.FlexRender header={header} />
                        {sorted === "asc" ? <ArrowUp className="size-3" /> : sorted === "desc" ? <ArrowDown className="size-3" /> : null}
                      </button>
                    </th>
                  );
                })}
                <th className="w-6" aria-hidden />
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row) => {
              const isOpen = expanded === row.id;
              return (
                <Fragment key={row.id}>
                  <tr
                    className={cn(
                      "cursor-pointer border-b border-border/60 transition-colors hover:bg-accent/40",
                      isOpen && "bg-accent/30",
                      row.original.flags.includes("stale") && "opacity-55",
                    )}
                    onClick={() => setExpanded(isOpen ? null : row.id)}
                    aria-expanded={isOpen}
                  >
                    {row.getAllCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={cn(
                          "px-2 py-1.5 align-middle",
                          NUMERIC.has(cell.column.id) && "text-right",
                          cell.column.id === "item" && "max-w-60",
                          DESKTOP_ONLY.has(cell.column.id) && "hidden xl:table-cell",
                        )}
                      >
                        <table.FlexRender cell={cell} />
                      </td>
                    ))}
                    <td className="pr-2 text-muted-foreground">
                      <ChevronDown className={cn("size-3.5 transition-transform", isOpen && "rotate-180")} />
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-border bg-surface">
                      <td colSpan={colCount + 1}>
                        <Breakdown o={row.original} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {paginate && data.length > pagination.pageSize && (
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <span className="num">
            {pagination.pageIndex * pagination.pageSize + 1}–{Math.min(data.length, (pagination.pageIndex + 1) * pagination.pageSize)} / {data.length}
          </span>
          <div className="flex items-center gap-2">
            <select
              value={pagination.pageSize}
              onChange={(e) => table.setPageSize(Number(e.target.value))}
              className="h-7 rounded-md border border-input bg-transparent px-1.5 text-xs"
              aria-label="Rows per page"
            >
              {[25, 50, 100].map((n) => (
                <option key={n} value={n} className="bg-popover">
                  {n} rows
                </option>
              ))}
            </select>
            <Button size="icon-sm" variant="outline" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Previous page">
              <ChevronLeft />
            </Button>
            <span className="num">
              {pagination.pageIndex + 1}/{table.getPageCount()}
            </span>
            <Button size="icon-sm" variant="outline" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Next page">
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export { WithTip };
