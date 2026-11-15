"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { RiskBadge, ScenarioBadge, TierBadge, QualityLabel, WithTip } from "@/components/badges";
import { ItemIcon } from "@/components/item-icon";
import { ProfitValue, RoiValue, Silver } from "@/components/values";
import { formatSilver } from "@/lib/format";
import type { Basket, BasketLine } from "@/lib/optimizer/budget";

const LIMIT_LABELS: Record<BasketLine["limitedBy"][number], string> = {
  budget_share: "Risk bazlı bütçe payı",
  remaining_budget: "Kalan bütçe",
  liquidity: "Likidite (hacim)",
  orderbook_depth: "Order Book derinliği",
};

export function BasketTable({ basket, compact }: { basket: Basket; compact?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead className="bg-surface">
          <tr className="border-b border-border text-[11px] tracking-wide text-muted-foreground uppercase">
            <th className="h-8 px-2 text-left font-medium">Item</th>
            <th className="px-2 text-left font-medium">İşlem</th>
            <th className="px-2 text-right font-medium">Adet</th>
            {!compact && <th className="px-2 text-right font-medium">Alış</th>}
            {!compact && <th className="px-2 text-right font-medium">Satış</th>}
            <th className="px-2 text-right font-medium">Sermaye</th>
            <th className="px-2 text-right font-medium">Tahmini kâr</th>
            <th className="px-2 text-right font-medium">ROI</th>
            <th className="px-2 text-left font-medium">Risk</th>
            {!compact && <th className="px-2 text-left font-medium">Sınırlayan</th>}
          </tr>
        </thead>
        <tbody>
          {basket.lines.map((line) => {
            const o = line.opportunity;
            return (
              <tr key={o.id} className="border-b border-border/60">
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <ItemIcon itemId={o.itemId} quality={o.quality} size={28} />
                    <div className="min-w-0">
                      <Link href={`/item/${encodeURIComponent(o.itemId)}`} className="block truncate font-medium hover:text-primary hover:underline">
                        {o.name}
                      </Link>
                      <div className="flex gap-1.5">
                        <TierBadge tier={o.tier} enchant={o.enchant} />
                        <QualityLabel quality={o.quality} />
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1 text-xs whitespace-nowrap">
                    {o.kind === "flip" ? (
                      <span>Flip · {o.buyCity}</span>
                    ) : (
                      <>
                        {o.buyCity} <ArrowRight className="size-3 text-muted-foreground" /> {o.sellCity}
                      </>
                    )}
                  </div>
                  <ScenarioBadge scenario={o.scenario} />
                </td>
                <td className="num px-2 text-right">{formatSilver(line.quantity)}</td>
                {!compact && (
                  <td className="px-2 text-right">
                    <Silver value={o.profit.buyPrice} />
                  </td>
                )}
                {!compact && (
                  <td className="px-2 text-right">
                    <Silver value={o.profit.sellPrice} />
                  </td>
                )}
                <td className="px-2 text-right">
                  <Silver value={line.capital} compact />
                </td>
                <td className="px-2 text-right">
                  <ProfitValue value={line.estimatedProfit} compact />
                </td>
                <td className="px-2 text-right">
                  <RoiValue value={o.profit.roi} />
                </td>
                <td className="px-2">
                  <RiskBadge risk={o.risk} />
                </td>
                {!compact && (
                  <td className="px-2 text-xs text-muted-foreground">
                    <WithTip tip="Adedi belirleyen kısıt. Birden fazla kısıt aynı adette kesişebilir.">
                      {line.limitedBy.map((l) => LIMIT_LABELS[l]).join(", ")}
                    </WithTip>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
