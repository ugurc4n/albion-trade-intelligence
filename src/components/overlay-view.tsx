"use client";

import { useQuery } from "@tanstack/react-query";
import { Lock, X } from "lucide-react";
import { useEffect, useState } from "react";
import { damageApi, formatDuration } from "@/lib/damage/client-api";
import { sessionKills } from "@/lib/damage/types";
import { zoneLabel } from "@/lib/damage/zone";
import { desktopApi, OVERLAY_LOCK_KEYS } from "@/lib/desktop";
import { formatCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

const MAX_ROWS = 6;

/**
 * Compact Damage Meter for the always-on-top overlay window: the current session's damage ranking and
 * your Fame/silver rates. Reads the same state as the Damage Meter page; it never talks to the game.
 */
export function OverlayView() {
  const [locked, setLocked] = useState(false);

  // The overlay window is transparent: drop the app background for this page only.
  useEffect(() => {
    document.documentElement.classList.add("overlay");
    return () => document.documentElement.classList.remove("overlay");
  }, []);
  useEffect(() => desktopApi()?.overlay.onLockChange(setLocked), []);

  const state = useQuery({
    queryKey: ["damage-state"],
    queryFn: ({ signal }) => damageApi.state(signal),
    refetchInterval: 1000,
  });
  const s = state.data;
  const session = s?.session ?? null;
  const seconds = session ? Math.max(1, (s!.now - session.startedAt) / 1000) : 1;
  const players = session?.players.filter((p) => p.damage > 0).slice(0, MAX_ROWS) ?? [];
  const top = players[0]?.damage ?? 0;
  const total = session?.players.reduce((sum, p) => sum + p.damage, 0) ?? 0;
  const run = session?.runs?.at(-1);
  const rate = (v: number | undefined) => formatCompact(((v ?? 0) * 3600) / seconds);

  return (
    <div
      className={cn(
        "flex h-dvh flex-col overflow-hidden rounded-lg border text-[12px] text-white select-none",
        locked ? "border-transparent bg-black/45" : "border-white/15 bg-[#0c0e22]/80",
      )}
    >
      <header
        className="flex items-center gap-2 border-b border-white/10 px-2 py-1"
        style={{ WebkitAppRegion: locked ? "no-drag" : "drag" } as React.CSSProperties}
      >
        <span className={cn("size-1.5 shrink-0 rounded-full", s?.capture.connected ? "bg-emerald-400" : "bg-white/30")} aria-hidden />
        <span className="min-w-0 flex-1 truncate font-medium">
          {session ? zoneLabel(run?.zone ?? null) : "Damage Meter"}
        </span>
        {session && <span className="num text-white/70">{formatDuration(s!.now - session.startedAt)}</span>}
        {locked ? (
          <Lock className="size-3 text-white/50" aria-label={`Locked — ${OVERLAY_LOCK_KEYS} to unlock`} />
        ) : (
          <span className="flex items-center gap-1" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            <button
              type="button"
              title={`Lock (clicks pass through to the game) — ${OVERLAY_LOCK_KEYS}`}
              className="rounded p-0.5 text-white/60 hover:bg-white/10 hover:text-white"
              onClick={() => desktopApi()?.overlay.setLocked(true)}
            >
              <Lock className="size-3" />
            </button>
            <button
              type="button"
              title="Close overlay"
              className="rounded p-0.5 text-white/60 hover:bg-white/10 hover:text-white"
              onClick={() => desktopApi()?.overlay.close()}
            >
              <X className="size-3" />
            </button>
          </span>
        )}
      </header>

      {!s ? (
        <p className="px-2 py-2 text-white/60">{state.isError ? "Cannot reach the app." : "Loading…"}</p>
      ) : !session ? (
        <p className="px-2 py-2 text-white/60">
          {s.capture.connected ? "Waiting for the first hit…" : "Capture is not running. Start it on the Damage Meter page."}
        </p>
      ) : (
        <>
          <ol className="min-h-0 flex-1 space-y-0.5 overflow-hidden px-1.5 py-1">
            {players.length === 0 && <li className="px-0.5 text-white/60">No damage yet.</li>}
            {session.unattributedDamage > 0 && (
              <li className="px-1.5 text-white/55" title="Players whose names arrive at the next zone change">
                Unknown players <span className="num">{formatCompact(session.unattributedDamage)}</span>
              </li>
            )}
            {players.map((p) => {
              const self = p.name === s.capture.selfName;
              return (
                <li key={p.name} className="relative overflow-hidden rounded px-1.5 py-0.5">
                  <span
                    className={cn("absolute inset-y-0 left-0", self ? "bg-fuchsia-500/35" : "bg-sky-400/25")}
                    style={{ width: `${top > 0 ? (p.damage / top) * 100 : 0}%` }}
                    aria-hidden
                  />
                  <span className="relative flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                    <span className="num text-white/70">{formatCompact(p.damage / seconds)}/s</span>
                    <span className="num w-12 text-right">{formatCompact(p.damage)}</span>
                    <span className="num w-9 text-right text-white/60">{total > 0 ? Math.round((p.damage / total) * 100) : 0}%</span>
                  </span>
                </li>
              );
            })}
          </ol>
          <footer className="flex flex-wrap gap-x-3 border-t border-white/10 px-2 py-1 text-white/70">
            <span>
              Fame/h <span className="num text-white">{rate(session.fame?.total)}</span>
            </span>
            <span>
              Silver/h <span className="num text-white">{rate(session.silver?.net)}</span>
            </span>
            <span>
              Kills <span className="num text-white">{sessionKills(session)}</span>
            </span>
          </footer>
        </>
      )}
    </div>
  );
}
