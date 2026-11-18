// Manual smoke test against the real Albion Data API: npx tsx scripts/smoke.ts
import { runOpportunities } from "@/lib/opportunities";
import { opportunitiesRequestSchema } from "@/lib/settings/schema";

async function main() {
  const t0 = Date.now();
  const req = opportunitiesRequestSchema.parse({ settings: {}, filters: { buyCity: "Martlock" }, kind: "all", limit: 5 });
  const res = await runOpportunities(req);
  console.log(`took ${Date.now() - t0}ms`);
  console.log(JSON.stringify(res.meta, null, 1));
  console.log("summary", res.summary, "orderbookChecked", res.orderbookChecked);
  const fmt = (o: (typeof res.flips.items)[number]) =>
    `${o.itemId} q${o.quality} ${o.buyCity}->${o.sellCity} ${o.scenario} buy=${o.profit.buyPrice} sell=${o.profit.sellPrice} unit=${o.profit.unitProfit.toFixed(0)} roi=${(o.profit.roi * 100).toFixed(1)}% qty=${o.recommendedQty} vol=${o.targetDailyVolume?.toFixed(1)} age=${o.dataAgeMinutes.toFixed(0)}m score=${o.score} ${o.risk}/${o.confidence} [${o.flags.join(",")}]`;
  console.log(`FLIPS total=${res.flips.total}`); res.flips.items.forEach((o) => console.log(" ", fmt(o)));
  console.log(`TRADES total=${res.trades.total}`); res.trades.items.forEach((o) => console.log(" ", fmt(o)));
  console.log("BASKET", { inv: res.basket.totalInvestment, profit: res.basket.estimatedProfit, unused: res.basket.unusedBudget });
  res.basket.lines.forEach((l) => console.log("  ", l.quantity, "x", fmt(l.opportunity), "cap", l.capital.toFixed(0), l.limitedBy));
  const bm = await runOpportunities(opportunitiesRequestSchema.parse({ settings: {}, filters: { buyCity: "all" }, kind: "blackmarket", limit: 8 }));
  console.log(`BLACK MARKET total=${bm.blackMarket.total} orderbookChecked=${bm.orderbookChecked}`);
  bm.blackMarket.items.forEach((o) => console.log(" ", fmt(o), o.orderbookDepth !== undefined ? `depth=${o.orderbookDepth}` : ""));
  const t1 = Date.now();
  await runOpportunities(req);
  console.log(`second (cached) run ${Date.now() - t1}ms`);
}
main().catch((e) => { console.error(e); process.exit(1); });
