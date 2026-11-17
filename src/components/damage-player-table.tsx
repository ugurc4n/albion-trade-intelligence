"use client";

import { ChevronRight, UsersRound } from "lucide-react";
import { Fragment, useId, useState, type ReactNode } from "react";
import { TierBadge } from "@/components/badges";
import { ItemIcon } from "@/components/item-icon";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { DAMAGE_METRICS, playerRanking, sessionSeconds, type DamageMetric } from "@/lib/damage/presentation";
import type { PlayerStats, SessionRecord } from "@/lib/damage/types";
import { formatCompact, formatPercent, formatSilver } from "@/lib/format";
import { cn } from "@/lib/utils";

function MainHand({ player }: { player: PlayerStats }) {
  const observation = player.mainHand;
  if (!observation) return <p className="text-muted-foreground">Main Hand: Unknown. Equipment is learned on zone entry or when it changes.</p>;
  const item = observation.item;
  if (!item) return <p lang="en">Main Hand: Unarmed</p>;
  return (
    <div className="flex items-center gap-2">
      <ItemIcon itemId={item.id} size={28} />
      <span lang="en">{item.nameEn}</span>
      <TierBadge tier={item.tier} enchant={item.enchant} />
      <span className="text-xs text-muted-foreground">Last seen Main Hand</span>
    </div>
  );
}

function PartyLine({ session, partyOnly, hidden }: { session: SessionRecord; partyOnly: boolean; hidden: number }) {
  const party = session.party ?? null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
      <UsersRound className="size-3.5" aria-hidden />
      {party ? (
        <span>
          <span lang="en" className="text-foreground">Party · {party.length}</span> {party.join(", ")}
          {partyOnly && hidden > 0 && ` · ${hidden} other ${hidden === 1 ? "player" : "players"} hidden`}
        </span>
      ) : (
        <span>Party not known yet: the game announces it at the next zone change. Everyone in view is shown until then.</span>
      )}
    </div>
  );
}

export function PlayerTable({ session, now, partyOnly, selfName, onShowAll, toolbar }: {
  session: SessionRecord;
  now: number;
  /** Hide players outside the party (only when the session knows the party). */
  partyOnly: boolean;
  selfName: string | null;
  onShowAll?: () => void;
  toolbar?: ReactNode;
}) {
  const [metric, setMetric] = useState<DamageMetric>("damage");
  const [expanded, setExpanded] = useState<string | null>(null);
  const id = useId();
  const party = partyOnly && session.party ? session.party : null;
  const ranking = playerRanking(session, metric, party);
  const hidden = session.players.length - ranking.players.length;
  const seconds = sessionSeconds(session, now);
  const kills = ranking.players.reduce((sum, p) => sum + (p.kills ?? 0), 0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Ranking metric">
          {(Object.keys(DAMAGE_METRICS) as DamageMetric[]).map((key) => (
            <Button key={key} variant={metric === key ? "secondary" : "ghost"} aria-pressed={metric === key}
              className={cn(metric === key && "bg-fuchsia-500/15 text-fuchsia-300")} onClick={() => setMetric(key)}>
              <span lang="en">{DAMAGE_METRICS[key]}</span>
            </Button>
          ))}
        </div>
        {toolbar}
      </div>
      <PartyLine session={session} partyOnly={partyOnly} hidden={hidden} />

      {ranking.players.length === 0 ? (
        <EmptyState title={session.players.length > 0 && party ? "No party member recorded" : "No players recorded yet"}>
          {session.players.length > 0 && party ? (
            <div className="space-y-3"><p>Only players outside your party were recorded in this session.</p>
              {onShowAll && <Button variant="outline" onClick={onShowAll}>Show everyone</Button>}
            </div>
          ) : session.endedAt !== null ? "No matched players in this session." :
            "The ranking shows up here as hits come in. If a player's name is missing, change zones while the capture is running (names arrive on zone entry)."}
        </EmptyState>
      ) : (
        <table className="w-full table-fixed text-sm sm:text-base">
          <caption className="sr-only">{DAMAGE_METRICS[metric]} ranking. Share is relative to the players shown.</caption>
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b border-border text-left">
              <th scope="col" className="w-[42%] px-3 py-2 font-medium sm:w-[40%]">Player</th>
              <th scope="col" lang="en" className="px-2 py-2 text-right font-medium">{DAMAGE_METRICS[metric]}</th>
              {metric === "damage" && <th scope="col" lang="en" className="px-2 py-2 text-right font-medium">DPS</th>}
              <th scope="col" className="w-[20%] px-3 py-2 text-right font-medium sm:w-[26%]">Share</th>
            </tr>
          </thead>
          <tbody>
            {ranking.players.map((player, index) => {
              const share = ranking.share(player);
              const isSelf = selfName !== null && player.name.toLowerCase() === selfName.toLowerCase();
              const open = expanded === player.name;
              const detailId = `${id}-${index}`;
              return (
                <Fragment key={player.name}>
                  <tr className={cn("border-b border-border/60 last:border-0 hover:bg-white/[0.02]", isSelf && "bg-fuchsia-500/8")}>
                    <td className="px-2 py-1.5 sm:px-3">
                      <button type="button" className="flex min-h-8 w-full min-w-0 items-center gap-1.5 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-2"
                        onClick={() => setExpanded(open ? null : player.name)} aria-expanded={open} aria-controls={open ? detailId : undefined}
                        aria-label={`${player.name} details`}>
                        <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
                        <span className="num hidden w-5 shrink-0 text-xs text-muted-foreground sm:block">{index + 1}</span>
                        {player.mainHand?.item && <span className="hidden shrink-0 sm:block"><ItemIcon itemId={player.mainHand.item.id} size={28} /></span>}
                        <span className="min-w-0 truncate font-medium" title={player.name}>{player.name}</span>
                        {isSelf && <span className="shrink-0 text-[11px] text-fuchsia-300">you</span>}
                      </button>
                    </td>
                    <td className="num px-2 py-2 text-right font-medium" title={formatSilver(player[metric])}>{formatCompact(player[metric])}</td>
                    {metric === "damage" && <td className="num px-2 py-2 text-right" title={formatSilver(player.damage / seconds)}>{formatCompact(player.damage / seconds)}</td>}
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-2">
                        <div className="hidden h-1.5 flex-1 overflow-hidden rounded-full bg-muted sm:block" aria-hidden>
                          <div className={cn("h-full rounded-full", metric === "heal" ? "bg-emerald-400" : metric === "taken" ? "bg-amber-400" : "bg-fuchsia-400")}
                            style={{ width: `${share * 100}%` }} />
                        </div>
                        <span className="num text-right text-xs text-muted-foreground sm:w-14 sm:text-sm">{formatPercent(share)}</span>
                      </div>
                    </td>
                  </tr>
                  {open && (
                    <tr id={detailId} className="border-b border-border bg-background/40">
                      <td colSpan={metric === "damage" ? 4 : 3} className="space-y-3 px-4 py-4 text-sm">
                        <MainHand player={player} />
                        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                          {([
                            ["Damage", formatSilver(player.damage)],
                            ["Healing", formatSilver(player.heal)],
                            ["Damage Taken", formatSilver(player.taken)],
                            ["Silver", player.silver ? formatSilver(player.silver) : "—"],
                            ["Hits", formatSilver(player.hits)],
                            ["Kills", player.kills ? String(player.kills) : "—"],
                          ] as const).map(([label, value]) => (
                            <div key={label}><dt lang="en" className="text-xs text-muted-foreground">{label}</dt><dd className="num mt-1">{value}</dd></div>
                          ))}
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="flex flex-wrap justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
        <span>{ranking.players.length} {ranking.players.length === 1 ? "player" : "players"} · {party ? "Party only" : "Everyone in view"}{kills > 0 && <> · Kills <span className="num text-foreground">{kills}</span></>}</span>
        <span>Total {DAMAGE_METRICS[metric]} <span className="num text-foreground">{formatSilver(ranking.total)}</span> · Share is relative to the players shown.</span>
        {metric === "damage" && <span>DPS is over the whole session, idle time included.</span>}
        {session.unattributedDamage > 0 && (
          <span title="Damage by players whose names were not announced yet (the capture started inside the zone; names arrive at the next zone change) and by pets/summons. Names are never guessed.">
            Unknown players: <span className="num">{formatSilver(session.unattributedDamage)}</span> · not in the total
          </span>
        )}
      </div>
    </div>
  );
}
