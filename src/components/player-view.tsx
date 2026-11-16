"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Search, Shield, Skull, Swords, Trophy } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Pill, WithTip } from "@/components/badges";
import { ItemIcon } from "@/components/item-icon";
import { KpiStrip, PageHeader, Panel } from "@/components/page-parts";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/states";
import { Input } from "@/components/ui/input";
import { useNow } from "@/hooks/use-now";
import { useSettings } from "@/hooks/use-settings";
import { QUALITY_LABELS, SERVERS } from "@/lib/albion/constants";
import { fetchPlayer, searchPlayers } from "@/lib/api-client";
import { ageFrom, formatAge, formatCompact, formatDateTime, formatDecimal, formatSilver } from "@/lib/format";
import { EQUIPMENT_SLOTS, type EventPlayer, type GearItem, type KillEvent, type LifetimeStats, type PlayerProfile } from "@/lib/killboard/types";
import { cn } from "@/lib/utils";

/* ---------- shared bits ---------- */

function guildLine(p: { guild: string; alliance: string }): string {
  return [p.alliance && `[${p.alliance}]`, p.guild].filter(Boolean).join(" ") || "No guild";
}

/** "OPEN_WORLD" → "Open World" */
function areaLabel(area: string | null): string {
  if (!area) return "—";
  return area
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function lossValue(e: KillEvent): number | null {
  if (!e.value || (e.value.equipment === null && e.value.inventory === null)) return null;
  return (e.value.equipment ?? 0) + (e.value.inventory ?? 0);
}

function itemTitle(item: GearItem): string {
  const quality = QUALITY_LABELS[item.quality];
  return `${item.name ?? item.type}${quality ? ` · ${quality}` : ""}${item.count > 1 ? ` × ${item.count}` : ""}`;
}

function GearIcon({ item, size = 40 }: { item: GearItem; size?: number }) {
  return (
    <span className="relative inline-block" title={itemTitle(item)}>
      <ItemIcon itemId={item.type} quality={Math.max(1, item.quality)} size={size} />
      {item.count > 1 && (
        <span className="num absolute right-0 bottom-0 rounded bg-background/85 px-0.5 text-[10px] leading-tight">{item.count}</span>
      )}
    </span>
  );
}

/* ---------- search ---------- */

export function PlayerSearchView() {
  const { settings, hydrated } = useSettings();
  const router = useRouter();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setQuery(text.trim()), 350);
    return () => clearTimeout(id);
  }, [text]);

  const results = useQuery({
    queryKey: ["player-search", settings.server, query],
    queryFn: ({ signal }) => searchPlayers(query, settings.server, signal),
    enabled: hydrated && query.length >= 2,
    staleTime: 5 * 60_000,
  });

  return (
    <div className="pb-8">
      <PageHeader
        section="players"
        title="Player Lookup"
        description={`Profile, lifetime statistics and PvP kill/death log for any player on ${SERVERS[settings.server].label}, from the official killboard. The value of lost gear is estimated from current market prices.`}
      />
      <div className="max-w-3xl space-y-3 px-3 lg:px-4">
        <Panel>
          <div className="relative p-3">
            <Search className="pointer-events-none absolute top-1/2 left-5.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                const first = results.data?.[0];
                if (e.key === "Enter" && first) router.push(`/players/${first.id}`);
              }}
              placeholder="Player name"
              aria-label="Search player name"
              className="h-9 pl-8 text-[14px]"
            />
          </div>
          {query.length < 2 ? null : results.isPending ? (
            <TableSkeleton rows={3} />
          ) : results.isError ? (
            <ErrorState error={results.error} onRetry={() => void results.refetch()} />
          ) : results.data.length === 0 ? (
            <EmptyState title="No players found">Check the spelling and the server in Settings ({SERVERS[settings.server].label}).</EmptyState>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {results.data.map((p) => (
                <li key={p.id}>
                  <Link href={`/players/${p.id}`} className="flex items-center gap-3 px-3 py-2 text-xs hover:bg-accent/40">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{p.name}</span>
                      <span className="text-muted-foreground">{guildLine(p)}</span>
                    </span>
                    <span className="text-muted-foreground">
                      Kill Fame <span className="num text-foreground">{formatCompact(p.killFame)}</span> · Death Fame{" "}
                      <span className="num text-foreground">{formatCompact(p.deathFame)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <p className="text-[11px] leading-relaxed text-muted-foreground/80">
          Only PvP kills and deaths are on the killboard; mob kills and dungeon runs are tracked by the Damage Meter instead. The
          killboard keeps a limited recent history and can lag a few minutes behind the game.
        </p>
      </div>
    </div>
  );
}

/* ---------- player detail ---------- */

function LifetimePanel({ l }: { l: LifetimeStats }) {
  const groups: { title: string; rows: [string, number][] }[] = [
    {
      title: "PvE Fame",
      rows: [
        ["Royal", l.pve.royal],
        ["Outlands", l.pve.outlands],
        ["Roads of Avalon", l.pve.avalon],
        ["Hellgate", l.pve.hellgate],
        ["Corrupted Dungeon", l.pve.corruptedDungeon],
        ["Mists", l.pve.mists],
      ],
    },
    {
      title: "Gathering Fame",
      rows: [
        ["Fiber", l.gathering.fiber],
        ["Hide", l.gathering.hide],
        ["Ore", l.gathering.ore],
        ["Rock", l.gathering.rock],
        ["Wood", l.gathering.wood],
      ],
    },
    {
      title: "Other",
      rows: [
        ["Crafting Fame", l.crafting],
        ["Fishing Fame", l.fishing],
        ["Farming Fame", l.farming],
        ["Crystal League", l.crystalLeague],
      ],
    },
  ];
  return (
    <Panel title="Lifetime statistics">
      <div className="grid gap-4 p-3 text-xs sm:grid-cols-3">
        {groups.map((g) => (
          <dl key={g.title} className="space-y-1">
            <dt className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{g.title}</dt>
            {g.rows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <span className="text-muted-foreground">{label}</span>
                <span className="num">{value > 0 ? formatCompact(value) : "—"}</span>
              </div>
            ))}
          </dl>
        ))}
      </div>
    </Panel>
  );
}

function Loadout({ who, player, inventory }: { who: string; player: EventPlayer; inventory?: GearItem[] }) {
  return (
    <div className="min-w-0 space-y-2">
      <p className="text-xs">
        <span className="text-muted-foreground">{who} </span>
        <Link href={`/players/${player.id}`} className="font-medium hover:text-primary hover:underline">
          {player.name}
        </Link>
        <span className="text-muted-foreground"> · {guildLine(player)} · IP </span>
        <span className="num">{player.itemPower || "—"}</span>
      </p>
      <div className="flex flex-wrap gap-1">
        {EQUIPMENT_SLOTS.map((slot) => {
          const item = player.equipment[slot];
          return item ? (
            <GearIcon key={slot} item={item} />
          ) : (
            <span key={slot} title={`${slot}: empty`} className="size-10 rounded border border-dashed border-border" />
          );
        })}
      </div>
      {inventory && inventory.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] text-muted-foreground">Inventory</p>
          <div className="flex flex-wrap gap-1">
            {inventory.map((item, i) => (
              <GearIcon key={`${item.type}-${i}`} item={item} size={32} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EventDetail({ e }: { e: KillEvent }) {
  return (
    <div className="grid gap-4 px-3 py-3 lg:grid-cols-[1fr_1fr_minmax(0,18rem)]">
      <Loadout who="Killer" player={e.killer} />
      <Loadout who="Victim" player={e.victim} inventory={e.victim.inventory} />
      <div className="space-y-2 text-xs">
        <p className="text-muted-foreground">
          {formatDateTime(Date.parse(e.at))} · {areaLabel(e.area)} · {e.partySize} {e.partySize === 1 ? "attacker" : "attackers"}
        </p>
        {e.value && (
          <p className="text-muted-foreground">
            Lost gear <span className="num text-foreground">{e.value.equipment === null ? "—" : formatSilver(e.value.equipment)}</span>
            {" · "}inventory <span className="num text-foreground">{e.value.inventory === null ? "—" : formatSilver(e.value.inventory)}</span>
            {e.value.unpriced > 0 && ` · ${e.value.unpriced} without a price`}
          </p>
        )}
        {e.participants.length > 0 && (
          <table className="w-full">
            <thead>
              <tr className="text-left text-[10px] text-muted-foreground uppercase">
                <th className="py-1 font-medium">Participant</th>
                <th className="text-right font-medium">Damage</th>
                <th className="text-right font-medium">Healing</th>
              </tr>
            </thead>
            <tbody>
              {e.participants.map((p) => (
                <tr key={p.id} className="border-t border-border/50">
                  <td className="py-1">
                    <Link href={`/players/${p.id}`} className="hover:text-primary hover:underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className="num text-right">{p.damage > 0 ? formatSilver(p.damage) : "—"}</td>
                  <td className="num text-right text-profit">{p.healing > 0 ? formatSilver(p.healing) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <a
          href={`https://albiononline.com/killboard/kill/${e.id}`}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-primary hover:underline"
        >
          Open on the official killboard
        </a>
      </div>
    </div>
  );
}

function EventTable({ events, side, now }: { events: KillEvent[]; side: "kills" | "deaths"; now: number | null }) {
  const [open, setOpen] = useState<number | null>(null);
  if (events.length === 0) {
    return <EmptyState title={side === "kills" ? "No kills on record" : "No deaths on record"}>The killboard only keeps recent history.</EmptyState>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] tracking-wide text-muted-foreground uppercase">
            <th className="px-3 py-2 font-medium">When</th>
            <th className="px-3 py-2 font-medium">{side === "kills" ? "Victim" : "Killed by"}</th>
            <th className="px-3 py-2 text-right font-medium">IP</th>
            <th className="px-3 py-2 text-right font-medium">Kill Fame</th>
            <th className="px-3 py-2 text-right font-medium">
              <WithTip tip="Estimated market value of the victim's gear and inventory (median of the Royal Cities' lowest Sell Orders).">
                Loot value
              </WithTip>
            </th>
            <th className="px-3 py-2 font-medium">Area</th>
            <th className="w-6" aria-hidden />
          </tr>
        </thead>
        <tbody>
          {events.map((e) => {
            const other = side === "kills" ? e.victim : e.killer;
            const isOpen = open === e.id;
            const value = lossValue(e);
            return (
              <Fragment key={e.id}>
                <tr
                  className={cn("cursor-pointer border-b border-border/60 hover:bg-accent/40", isOpen && "bg-accent/30")}
                  onClick={() => setOpen(isOpen ? null : e.id)}
                  aria-expanded={isOpen}
                >
                  <td className="px-3 py-1.5 text-xs whitespace-nowrap text-muted-foreground" title={formatDateTime(Date.parse(e.at))}>
                    {formatAge(ageFrom(Date.parse(e.at), now))} ago
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      {e.victim.equipment.MainHand && <GearIcon item={e.victim.equipment.MainHand} size={28} />}
                      <div className="min-w-0">
                        <span className="block truncate font-medium">{other.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{guildLine(other)}</span>
                      </div>
                      {e.partySize > 1 && <Pill className="border-border text-muted-foreground">{e.partySize} vs 1</Pill>}
                    </div>
                  </td>
                  <td className="num px-3 text-right">{other.itemPower || "—"}</td>
                  <td className="num px-3 text-right">{formatSilver(e.fame)}</td>
                  <td className={cn("num px-3 text-right", side === "kills" ? "text-profit" : "text-loss")}>{value === null ? "—" : formatCompact(value)}</td>
                  <td className="px-3 text-xs text-muted-foreground">{areaLabel(e.area)}</td>
                  <td className="pr-2 text-muted-foreground">
                    <ChevronDown className={cn("size-3.5 transition-transform", isOpen && "rotate-180")} />
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-border bg-surface">
                    <td colSpan={7}>
                      <EventDetail e={e} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type Tab = "kills" | "deaths" | "top";

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs",
        active ? "border-primary/60 bg-primary/15 text-primary" : "border-input text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function sumValues(events: KillEvent[]): number {
  return events.reduce((s, e) => s + (lossValue(e) ?? 0), 0);
}

function ProfileKpis({ p, kills, deaths }: { p: PlayerProfile; kills: KillEvent[]; deaths: KillEvent[] }) {
  return (
    <KpiStrip
      items={[
        { label: "Kill Fame", value: formatCompact(p.killFame), sub: `Death Fame ${formatCompact(p.deathFame)}`, tone: "rose" },
        { label: "Fame ratio", value: formatDecimal(p.fameRatio), sub: "Kill Fame / Death Fame", tone: "violet" },
        {
          label: "Recent kills",
          value: <span className="num">{kills.length}</span>,
          sub: `${formatCompact(sumValues(kills))} silver of loot destroyed`,
          tip: "Kills in the killboard's recent history, and the estimated value of what their victims lost.",
          tone: "emerald",
        },
        {
          label: "Recent deaths",
          value: <span className="num">{deaths.length}</span>,
          sub: `${formatCompact(sumValues(deaths))} silver lost`,
          tone: "amber",
        },
        { label: "PvE Fame", value: formatCompact(p.lifetime?.pve.total ?? null), sub: `Gathering ${formatCompact(p.lifetime?.gathering.total ?? null)}`, tone: "cyan" },
      ]}
    />
  );
}

export function PlayerDetailView() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const { settings, hydrated } = useSettings();
  const now = useNow();
  const [tab, setTab] = useState<Tab>("kills");
  const query = useQuery({
    queryKey: ["player", settings.server, id],
    queryFn: ({ signal }) => fetchPlayer(id, settings.server, signal),
    enabled: hydrated,
    staleTime: 60_000,
  });

  if (query.isError) {
    return (
      <div className="p-4">
        <Panel>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Panel>
      </div>
    );
  }
  const data = query.data;
  if (!data) {
    return (
      <div className="p-4">
        <TableSkeleton rows={8} note="Loading from the killboard…" />
      </div>
    );
  }
  const p = data.player;
  const events = tab === "kills" ? data.kills : tab === "deaths" ? data.deaths : data.topKills;

  return (
    <div className="pb-8">
      <PageHeader
        section="players"
        title={p.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2">
            <Shield className="size-3.5" aria-hidden />
            {guildLine(p)}
            <span>· {SERVERS[settings.server].label}</span>
            <span>· fetched {formatAge(ageFrom(data.fetchedAt, now))} ago</span>
          </span>
        }
        actions={
          <Link href="/players" className="text-xs text-muted-foreground hover:text-primary">
            Search another player
          </Link>
        }
      />
      <div className="space-y-3 px-3 lg:px-4">
        <ProfileKpis p={p} kills={data.kills} deaths={data.deaths} />
        {p.lifetime && <LifetimePanel l={p.lifetime} />}

        <Panel
          title={
            <span className="flex flex-wrap items-center gap-2">
              <TabButton active={tab === "kills"} onClick={() => setTab("kills")} icon={<Swords className="size-3.5" />}>
                Kills ({data.kills.length})
              </TabButton>
              <TabButton active={tab === "deaths"} onClick={() => setTab("deaths")} icon={<Skull className="size-3.5" />}>
                Deaths ({data.deaths.length})
              </TabButton>
              <TabButton active={tab === "top"} onClick={() => setTab("top")} icon={<Trophy className="size-3.5" />}>
                Top kills this week ({data.topKills.length})
              </TabButton>
            </span>
          }
        >
          <EventTable key={tab} events={events} side={tab === "deaths" ? "deaths" : "kills"} now={now} />
        </Panel>

        {data.warnings.length > 0 && <p className="text-[11px] text-warn">Some data could not be loaded: {data.warnings.join(" · ")}</p>}
        <p className="text-[11px] leading-relaxed text-muted-foreground/80">
          Loot values are estimates from the Royal Cities&apos; current Sell Orders; items without a recent price are left out and
          counted separately. Click a row for both loadouts, the victim&apos;s inventory and every participant&apos;s damage and healing.
        </p>
      </div>
    </div>
  );
}
