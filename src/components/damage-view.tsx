"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleDot,
  Copy,
  Crosshair,
  History,
  Loader2,
  PictureInPicture2,
  Play,
  ShieldCheck,
  Square,
  Trash2,
  UserRound,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Pill, TierBadge, WithTip } from "@/components/badges";
import { FieldLabel, NativeSelect } from "@/components/filters-bar";
import { ItemIcon } from "@/components/item-icon";
import { PageHeader, Panel } from "@/components/page-parts";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { configFor } from "@/lib/damage/calibrate";
import { damageApi, formatDuration, parseNames, type CalibrationResponse } from "@/lib/damage/client-api";
import type { DamageState } from "@/lib/damage/service";
import { sessionKills, type DamageConfig, type DamageSettings, type PlayerStats, type SessionRecord } from "@/lib/damage/types";
import { zoneLabel } from "@/lib/damage/zone";
import { desktopApi, OVERLAY_LOCK_KEYS, OVERLAY_TOGGLE_KEYS } from "@/lib/desktop";
import { formatCompact, formatPercent, formatSilver } from "@/lib/format";
import { cn } from "@/lib/utils";

const NAMES_KEY = "ati.damage.names.v1";
const CAPTURE_SOURCE = "tools/albion-capture/AlbionCapture.cs";
const COMPILE_CMD = String.raw`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /out:AlbionCapture.exe AlbionCapture.cs`;
const IDLE_OPTIONS = [2, 3, 5, 10, 15];

/* ---------- small helpers ---------- */

function subscribeStorage(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}
function readStoredNames(): string {
  try {
    return window.localStorage.getItem(NAMES_KEY) ?? "";
  } catch {
    return "";
  }
}
function writeStoredNames(v: string) {
  try {
    window.localStorage.setItem(NAMES_KEY, v);
  } catch {
    // storage unavailable — names just won't be remembered
  }
}

function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border bg-background/60 py-1 pr-1 pl-2">
      <code className="num min-w-0 flex-1 truncate text-[11px]">{text}</code>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Copy"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? <CheckCircle2 className="text-profit" /> : <Copy />}
      </Button>
    </div>
  );
}

function Step({ n, done, children }: { n: number; done?: boolean; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span
        className={cn(
          "num mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-[10px]",
          done ? "border-profit/50 text-profit" : "border-border text-muted-foreground",
        )}
      >
        {done ? <CheckCircle2 className="size-3.5" /> : n}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5 text-xs leading-relaxed">{children}</div>
    </li>
  );
}

function Disclosure({ title, children, defaultOpen = false }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group rounded-md border border-border" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-2 text-xs text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
        {title}
      </summary>
      <div className="border-t border-border p-2.5">{children}</div>
    </details>
  );
}

/* ---------- player table ---------- */

function FameSummary({ session, now }: { session: SessionRecord; now: number }) {
  const fame = session.fame;
  if (!fame) return (
    <div className="border-b border-border px-3 py-3 text-xs text-muted-foreground">
      <span lang="en" className="font-medium text-foreground">Personal Fame</span> · No Fame for your character in this session.
      {!session.endedAt && " Change zones while the capture is running; Fame shows up here as you earn it."}
    </div>
  );
  const seconds = Math.max(1, ((session.endedAt ?? now) - session.startedAt) / 1000);
  const kills = sessionKills(session);
  const metrics = [
    ["Total Fame", formatSilver(fame.total)],
    ["Fame/hour", formatSilver(fame.total * 3600 / seconds)],
    ...(kills > 0 ? [["Fame/kill", formatSilver(fame.total / kills)]] : []),
    ["Fame (zone incl.)", formatSilver(fame.zoneIncluded)],
    ["Premium bonus", formatSilver(fame.premium)],
    ["Satchel bonus", formatSilver(fame.satchel)],
    ["Bonus modifier (last)", fame.lastBonusPercent === null ? "Unknown" : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(fame.lastBonusPercent)}%`],
  ];
  return (
    <div className="border-b border-border bg-fuchsia-500/5 px-3 py-3">
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span lang="en" className="font-medium">Personal Fame</span>
        <span className="font-medium text-fuchsia-300">{fame.name}</span>
        <span className="text-muted-foreground">· rewards earned in this session only</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 xl:grid-cols-6">
        {metrics.map(([label, value]) => (
          <div key={label}>
            <dt lang="en" className="text-[11px] text-muted-foreground">{label}</dt>
            <dd className="num mt-1 text-base font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Total Fame is the zone-included Fame plus the Premium and Satchel contributions.
        Bonus modifier is the rate reported with the last reward; it is already part of the Fame and is not added again.
        Buff names and remaining time are not in this data. Rewards earned while the capture was not running are not included.
      </p>
    </div>
  );
}

function RunsSummary({ session, now }: { session: SessionRecord; now: number }) {
  const runs = session.runs ?? [];
  const balance = session.balance;
  if (runs.length === 0 && !balance) return null;
  const change = balance ? balance.end - balance.start : null;
  return (
    <div className="space-y-2.5 border-b border-border px-3 py-3 text-xs">
      {balance && change !== null && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span lang="en" className="font-medium">Balance</span>
          <span className={cn("num text-base font-semibold", change > 0 ? "text-profit" : change < 0 ? "text-loss" : "")}>
            {change > 0 ? "+" : ""}{formatSilver(change)}
          </span>
          <span className="text-muted-foreground">
            · <span className="num">{formatSilver(balance.start)}</span> → <span className="num">{formatSilver(balance.end)}</span>
            {" "}(includes silver picked up, sales, purchases and repairs)
          </span>
        </div>
      )}
      {runs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">{runs.length} {runs.length === 1 ? "run" : "runs"}</span>
          {runs.map((r) => (
            <div key={r.startedAt} className="rounded-md border border-border px-2.5 py-1.5">
              <span lang="en" className="block font-medium">{zoneLabel(r.zone)}</span>
              <span className="text-muted-foreground">
                {formatDuration((r.endedAt ?? session.endedAt ?? now) - r.startedAt)}
                {r.fame > 0 && <> · Fame <span className="num text-foreground">{formatCompact(r.fame)}</span></>}
                {r.silver > 0 && <> · Silver <span className="num text-foreground">{formatCompact(r.silver)}</span></>}
                {r.damage > 0 && <> · Damage <span className="num text-foreground">{formatCompact(r.damage)}</span></>}
                {(r.kills ?? 0) > 0 && <> · Kills <span className="num text-foreground">{r.kills}</span></>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SilverSummary({ session, now }: { session: SessionRecord; now: number }) {
  const silver = session.silver;
  if (!silver) return (
    <div className="border-b border-border px-3 py-3 text-xs text-muted-foreground">
      <span lang="en" className="font-medium text-foreground">Silver</span> · No silver picked up in this session.
    </div>
  );
  const seconds = Math.max(1, ((session.endedAt ?? now) - session.startedAt) / 1000);
  const kills = sessionKills(session);
  const metrics = [
    ["Picked up", formatSilver(silver.net)],
    ["Silver/hour", formatSilver(silver.net * 3600 / seconds)],
    ...(kills > 0 ? [["Silver/kill", formatSilver(silver.net / kills)]] : []),
    ["Before tax", formatSilver(silver.preTax)],
    ["Tax", formatSilver(silver.tax)],
    ["Pickups", String(silver.pickups)],
  ];
  return (
    <div className="border-b border-border bg-amber-500/5 px-3 py-3">
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span lang="en" className="font-medium">Silver</span>
        <span className="font-medium text-amber-300">{silver.name}</span>
        <span className="text-muted-foreground">· picked up in this session only</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 xl:grid-cols-6">
        {metrics.map(([label, value]) => (
          <div key={label}>
            <dt lang="en" className="text-[11px] text-muted-foreground">{label}</dt>
            <dd className="num mt-1 text-base font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Picked up is the silver you received after cluster and guild tax. In a party only your own share
        is counted. Sales, purchases and repairs are not included.
      </p>
    </div>
  );
}

function MainHandCell({ player }: { player: PlayerStats }) {
  const observation = player.mainHand;
  if (!observation) {
    return (
      <span
        className="cursor-help text-xs text-muted-foreground underline decoration-dotted underline-offset-2"
        title="The Main Hand is learned when a player enters the zone or changes equipment. Change zones once after starting the capture."
      >
        Unknown
      </span>
    );
  }
  const item = observation.item;
  if (!item) return <span lang="en" className="text-xs text-muted-foreground">Unarmed</span>;
  return (
    <div className="flex items-center gap-2" title={`Last seen Main Hand: ${item.nameEn} · T${item.tier}.${item.enchant}`}>
      <ItemIcon key={item.id} itemId={item.id} size={28} />
      <div className="min-w-0">
        <span lang="en" className="block max-w-44 truncate text-xs">{item.nameEn}</span>
        <TierBadge tier={item.tier} enchant={item.enchant} />
      </div>
    </div>
  );
}

function PlayerTable({
  session,
  now,
  onlyNames,
  selfName,
}: {
  session: SessionRecord;
  now: number;
  onlyNames: string[] | null;
  selfName: string | null;
}) {
  const end = session.endedAt ?? now;
  const seconds = Math.max(1, (end - session.startedAt) / 1000);
  const allowed = onlyNames ? new Set(onlyNames.map((n) => n.toLowerCase())) : null;
  if (allowed && selfName) allowed.add(selfName.toLowerCase());
  const players: PlayerStats[] = session.players.filter((p) => !allowed || allowed.has(p.name.toLowerCase()));
  const total = players.reduce((s, p) => s + p.damage, 0);
  const top = players.reduce((m, p) => Math.max(m, p.damage), 0);

  if (players.length === 0) {
    return (
      <>
      <RunsSummary session={session} now={now} />
      <FameSummary session={session} now={now} />
      <SilverSummary session={session} now={now} />
      <EmptyState title={session.endedAt !== null ? "No damage recorded" : "No damage yet"}>
        {session.endedAt !== null ? "No matched Damage in this session." :
          "The session is open; hits show up here as they come in. If a player's name is missing, the capture has to be running when that player enters the zone (names arrive on zone entry)."}
      </EmptyState>
      </>
    );
  }

  return (
    <>
    <RunsSummary session={session} now={now} />
    <FameSummary session={session} now={now} />
    <SilverSummary session={session} now={now} />
    <div className="overflow-x-auto">
      <table className="w-full min-w-[840px] text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] tracking-wide text-muted-foreground uppercase">
            <th className="px-3 py-2 font-medium">Player</th>
            <th lang="en" className="px-3 py-2 font-medium">
              <WithTip tip="Last seen Main Hand. Updated whenever an equipment packet arrives.">Main Hand</WithTip>
            </th>
            <th lang="en" className="px-3 py-2 text-right font-medium">Damage</th>
            <th className="w-[28%] px-3 py-2 font-medium">Share</th>
            <th lang="en" className="px-3 py-2 text-right font-medium">DPS</th>
            <th lang="en" className="px-3 py-2 text-right font-medium">Healing</th>
            <th lang="en" className="px-3 py-2 text-right font-medium">Damage Taken</th>
            <th lang="en" className="px-3 py-2 text-right font-medium">Hits</th>
            <th lang="en" className="px-3 py-2 text-right font-medium">
              <WithTip tip="Mobs this player landed the killing blow on.">Kills</WithTip>
            </th>
          </tr>
        </thead>
        <tbody>
          {players.map((p, idx) => {
            const share = total > 0 ? p.damage / total : 0;
            const isSelf = selfName !== null && p.name === selfName;
            return (
              <tr key={p.name} className={cn("border-b border-border/60 last:border-0", isSelf && "bg-fuchsia-500/8")}>
                <td className="px-3 py-2">
                  <span className="num mr-2 text-muted-foreground">{idx + 1}</span>
                  <span className="font-medium">{p.name}</span>
                  {isSelf && <span className="ml-1.5 text-[11px] text-fuchsia-300">you</span>}
                </td>
                <td className="px-3 py-2"><MainHandCell player={p} /></td>
                <td className="num px-3 py-2 text-right">{formatSilver(p.damage)}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-fuchsia-400" style={{ width: `${top > 0 ? (p.damage / top) * 100 : 0}%` }} />
                    </div>
                    <span className="num w-12 text-right text-xs text-muted-foreground">{formatPercent(share)}</span>
                  </div>
                </td>
                <td className="num px-3 py-2 text-right">{formatSilver(p.damage / seconds)}</td>
                <td className="num px-3 py-2 text-right text-profit">{p.heal > 0 ? formatSilver(p.heal) : "—"}</td>
                <td className="num px-3 py-2 text-right text-muted-foreground">{p.taken > 0 ? formatSilver(p.taken) : "—"}</td>
                <td className="num px-3 py-2 text-right text-muted-foreground">{p.hits}</td>
                <td className="num px-3 py-2 text-right">{p.kills ? p.kills : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-xs text-muted-foreground">
        <span>
          Duration <span className="num text-foreground">{formatDuration(end - session.startedAt)}</span>
        </span>
        <span>
          Total Damage <span className="num text-foreground">{formatSilver(total)}</span>
        </span>
        <span>
          Party DPS <span className="num text-foreground">{formatSilver(total / seconds)}</span>
        </span>
        <span>
          Kills <span className="num text-foreground">{players.reduce((sum, p) => sum + (p.kills ?? 0), 0)}</span>
        </span>
        {session.unattributedDamage > 0 && (
          <span title="Damage without a matched owner: pets/summons or players who entered the zone before their name was captured.">
            Unattributed <span className="num text-foreground">{formatSilver(session.unattributedDamage)}</span>
          </span>
        )}
      </div>
    </div>
    </>
  );
}

/* ---------- connection ---------- */

const LAUNCHER_TEXT: Record<DamageState["launcher"]["state"], string> = {
  idle: "Off",
  starting: "Starting…",
  running: "Running",
  stopping: "Stopping…",
  denied: "Permission denied",
  error: "Could not start",
};

/** Desktop app: one big Start/Stop button instead of terminal instructions. */
function LauncherControl({ s }: { s: DamageState }) {
  const qc = useQueryClient();
  const l = s.launcher;
  const invalidate = () => qc.invalidateQueries({ queryKey: ["damage-state"] });
  const start = useMutation({ mutationFn: () => damageApi.control({ action: "capture-start" }), onSuccess: invalidate });
  const stop = useMutation({ mutationFn: () => damageApi.control({ action: "capture-stop" }), onSuccess: invalidate });
  const active = l.state === "running" || l.state === "starting";
  const busy = start.isPending || stop.isPending || l.state === "stopping";
  const error = start.error ?? stop.error;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-fuchsia-400/25 bg-fuchsia-500/8 p-3">
      {active ? (
        <Button size="lg" variant="outline" onClick={() => stop.mutate()} disabled={busy} className="min-w-36">
          {busy ? <Loader2 className="animate-spin" /> : <Square />} Stop
        </Button>
      ) : (
        <Button size="lg" onClick={() => start.mutate()} disabled={busy} className="min-w-36 bg-fuchsia-500 text-white hover:bg-fuchsia-400">
          {busy ? <Loader2 className="animate-spin" /> : <Play />} Start
        </Button>
      )}
      <div className="min-w-0 flex-1 text-xs leading-relaxed">
        <p className="font-medium">{LAUNCHER_TEXT[l.state]}</p>
        <p className="text-muted-foreground">
          {l.message ??
            (l.state === "running"
              ? "Reading game traffic. It stops by itself when you close the app."
              : "Click Start; Windows asks for permission once — choose “Yes”.")}
        </p>
        {error && <p className="text-loss">{error.message}</p>}
      </div>
    </div>
  );
}

/** The desktop bridge is there from the first render and never changes. */
const subscribeNothing = () => () => {};

/** Desktop app only: shows or hides the always-on-top in-game overlay. */
function OverlayControl() {
  const available = useSyncExternalStore(subscribeNothing, () => desktopApi() !== null, () => false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const api = desktopApi();
    if (!api) return;
    void api.overlay.isOpen().then(setOpen);
    return api.overlay.onOpenChange(setOpen);
  }, []);
  if (!available) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
      <Button size="sm" variant={open ? "outline" : "default"} onClick={() => desktopApi()?.overlay.toggle()} className="min-w-36">
        <PictureInPicture2 /> {open ? "Hide overlay" : "Show overlay"}
      </Button>
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
        A small always-on-top window with the damage ranking and your Fame/silver rates. Drag it by its title bar and resize it
        from the edges. <span className="text-foreground">{OVERLAY_TOGGLE_KEYS}</span> shows or hides it,{" "}
        <span className="text-foreground">{OVERLAY_LOCK_KEYS}</span> locks it so clicks pass through to the game. Play in{" "}
        <span lang="en" className="text-foreground">Windowed Fullscreen</span> mode; exclusive fullscreen hides other windows.
      </p>
    </div>
  );
}

function ConnectionPanel({ s }: { s: DamageState }) {
  const c = s.capture;
  const desktop = s.launcher.available;
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          {c.connected ? <Wifi className="size-4 text-profit" /> : <WifiOff className="size-4 text-muted-foreground" />}
          Capture
        </span>
      }
      actions={
        c.connected ? (
          <Pill className="border-profit/30 text-profit">
            Connected · <span className="num">{c.packetsPerSecond}</span> packets/s
          </Pill>
        ) : (
          <Pill className="border-border text-muted-foreground">Waiting</Pill>
        )
      }
    >
      <div className="space-y-3 p-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Packets</dt>
            <dd className="num">{formatSilver(c.packetsReceived)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Messages</dt>
            <dd className="num">{formatSilver(c.decode.messages)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Known players</dt>
            <dd className="num">{c.identitiesKnown}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Undecoded</dt>
            <dd className="num">{c.decode.errors + c.decode.encrypted}</dd>
          </div>
        </dl>
        {desktop && <LauncherControl s={s} />}
        <OverlayControl />
        {!desktop && (
          <Disclosure title="Setup (Windows)" defaultOpen={!c.connected && c.packetsReceived === 0}>
          <ol className="space-y-3">
            <Step n={1}>
              <p>
                Copy <code className="num">{CAPTURE_SOURCE}</code> to the Windows PC. It is a single file; you can read it to see what it does.
              </p>
            </Step>
            <Step n={2}>
              <p>Open PowerShell in the same folder and compile it with Windows&apos; built-in compiler (no download needed):</p>
              <CopyLine text={COMPILE_CMD} />
            </Step>
            <Step n={3} done={c.connected}>
              <p>
                Open PowerShell as administrator and run it in the same folder while the game is running. The leading <code className="num">.\</code>{" "}
                is required by PowerShell:
              </p>
              {s.ingestUrls.length === 0 ? (
                <p className="text-warn">No local network address found for this computer.</p>
              ) : (
                s.ingestUrls.map((u) => <CopyLine key={u} text={`.\\AlbionCapture.exe ${u}`} />)
              )}
              <p className="text-muted-foreground">
                If the app runs on the same Windows PC, the address is <code className="num">http://localhost:3100</code>.
              </p>
            </Step>
          </ol>
          </Disclosure>
        )}
        {c.decode.lastError && c.decode.errors > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Last decode error: <span className="num">{c.decode.lastError}</span>
          </p>
        )}
      </div>
    </Panel>
  );
}

/* ---------- automation + calibration ---------- */

function autoStatusText(s: DamageState): { tone: "ok" | "wait" | "off"; text: string } {
  if (!s.settings.autoCalibrate && !s.config) return { tone: "off", text: "Auto calibration is off; you can calibrate manually below." };
  if (s.config && s.auto.state === "stale") return { tone: "wait", text: s.auto.note };
  if (s.config) {
    const when = new Date(s.config.calibratedAt).toLocaleString("en-GB");
    const how = s.config.source === "auto" ? "automatically" : "manually";
    return { tone: "ok", text: `Damage event recognised (${how}, ${when}). If a patch breaks it, it is renewed automatically.` };
  }
  if (s.auto.state === "waiting") return { tone: "wait", text: s.auto.note };
  return { tone: "wait", text: "The damage event will be found automatically when you hit a mob." };
}

function ManualCalibration({ recording, connected }: { recording: DamageState["recording"]; connected: boolean }) {
  const qc = useQueryClient();
  const [names, setNames] = useState("");
  const [result, setResult] = useState<CalibrationResponse | null>(null);
  const [choice, setChoice] = useState(0);
  const nameList = parseNames(names);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["damage-state"] });

  const startRec = useMutation({ mutationFn: () => damageApi.control({ action: "recording-start" }), onSuccess: invalidate });
  const stopAndAnalyze = useMutation({
    mutationFn: async () => {
      await damageApi.control({ action: "recording-stop" });
      return damageApi.calibrate(nameList);
    },
    onSuccess: (r) => {
      setResult(r);
      setChoice(0);
    },
    onSettled: invalidate,
  });
  const save = useMutation({
    mutationFn: (c: DamageConfig) => damageApi.control({ action: "config-save", config: c }),
    onSuccess: () => {
      setResult(null);
      void invalidate();
    },
  });

  // The timestamp is only stamped when saving (event handler), so render stays pure.
  const buildConfig = (now: number) =>
    result ? (choice === 0 && result.suggested ? result.suggested : configFor(result, choice, now)) : null;
  const canSave = buildConfig(0) !== null;
  const error = startRec.error ?? stopAndAnalyze.error ?? save.error;

  return (
    <div className="space-y-2.5 text-xs">
      <p className="text-muted-foreground">
        Use this if automatic detection gets something wrong: record, hit a mob, and compare the candidates with the damage numbers you saw in game.
      </p>
      <label className="block space-y-1">
        <FieldLabel>Character names (optional)</FieldLabel>
        <Input value={names} onChange={(e) => setNames(e.target.value)} placeholder="Leave empty to detect automatically" className="h-8 text-[13px]" />
      </label>
      {recording ? (
        <div className="flex flex-wrap items-center gap-2">
          <Pill className="border-loss/40 text-loss">
            <CircleDot className="size-3 animate-pulse" /> Recording · <span className="num">{recording.packets}</span> packets
          </Pill>
          <Button size="sm" onClick={() => stopAndAnalyze.mutate()} disabled={stopAndAnalyze.isPending}>
            {stopAndAnalyze.isPending ? <Loader2 className="animate-spin" /> : <Square />} Stop and analyse
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => startRec.mutate()} disabled={startRec.isPending || !connected}>
          <Circle className="text-loss" /> Start recording
        </Button>
      )}

      {result &&
        (result.health.length === 0 ? (
          <p className="text-warn">
            No damage event found in the recording ({result.packets} packets). Make sure you change zones and hit a mob while recording.
            {result.namesMissing.length > 0 && ` Names not seen in the recording: ${result.namesMissing.join(", ")}.`}
          </p>
        ) : (
          <div className="space-y-2">
            <div className="space-y-1.5" role="radiogroup" aria-label="Damage event candidates">
              {result.health.map((h, idx) => (
                <label
                  key={`${h.rule.signature}-${h.rule.causerKey}-${h.rule.changeKey}`}
                  className={cn(
                    "flex cursor-pointer gap-2 rounded-md border p-2",
                    choice === idx ? "border-primary/60 bg-primary/5" : "border-border hover:bg-muted/40",
                  )}
                >
                  <input
                    type="radio"
                    name="candidate"
                    className="mt-0.5 accent-[var(--primary)]"
                    checked={choice === idx}
                    onChange={() => setChoice(idx)}
                  />
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="num font-medium">{h.rule.signature}</span>
                      <span className="num text-muted-foreground">
                        causer {h.rule.causerKey} · change {h.rule.changeKey}
                        {h.rule.targetKey === null ? "" : ` · target ${h.rule.targetKey}`}
                      </span>
                      {idx === 0 && <Pill className="border-primary/40 text-primary">Suggested</Pill>}
                      <span className="text-muted-foreground">
                        {h.damageRows} hits · {h.subjectMobRows} on mobs
                      </span>
                    </span>
                    <span className="block text-muted-foreground">
                      Sample damage values: <span className="num text-foreground">{h.sampleDamage.join(", ")}</span>
                    </span>
                    <span className="block text-muted-foreground">{h.byName.map((b) => `${b.name} ${formatCompact(b.damage)}`).join(" · ")}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  const config = buildConfig(Date.now());
                  if (config) save.mutate(config);
                }}
                disabled={!canSave || save.isPending}
              >
                {save.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Save this candidate
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setResult(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ))}
      {error && <p className="text-loss">{error instanceof Error ? error.message : String(error)}</p>}
    </div>
  );
}

function AutomationPanel({ s }: { s: DamageState }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["damage-state"] });
  const saveSettings = useMutation({
    mutationFn: (settings: DamageSettings) => damageApi.control({ action: "settings-save", settings }),
    onSuccess: invalidate,
  });
  const clear = useMutation({ mutationFn: () => damageApi.control({ action: "config-clear" }), onSuccess: invalidate });
  const set = (patch: Partial<DamageSettings>) => saveSettings.mutate({ ...s.settings, ...patch });
  const status = autoStatusText(s);

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Bot className="size-4 text-muted-foreground" /> Automation
        </span>
      }
      actions={
        s.capture.selfName ? (
          <Pill className="border-transparent bg-fuchsia-500/15 text-fuchsia-300">
            <UserRound className="size-3" /> {s.capture.selfName}
          </Pill>
        ) : null
      }
    >
      <div className="space-y-3 p-3 text-xs">
        <div
          className={cn(
            "flex items-start gap-2 rounded-md border px-2.5 py-2",
            status.tone === "ok" ? "border-profit/30" : status.tone === "wait" ? "border-warn/30" : "border-border",
          )}
        >
          {status.tone === "ok" ? (
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-profit" />
          ) : (
            <Crosshair className="mt-0.5 size-3.5 shrink-0 text-warn" />
          )}
          <p className="min-w-0 flex-1 leading-relaxed">{status.text}</p>
          {s.config && (
            <Button variant="ghost" size="xs" onClick={() => clear.mutate()} disabled={clear.isPending}>
              Reset
            </Button>
          )}
        </div>
        {!s.capture.selfName && s.config && (
          <p className="text-muted-foreground">Your name is recognised at the next zone change.</p>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded-md border border-border px-2.5 py-2">
            <span>
              <span className="block font-medium">Auto calibration</span>
              <span className="text-muted-foreground">Finds the damage event from live traffic.</span>
            </span>
            <Switch checked={s.settings.autoCalibrate} onCheckedChange={(v) => set({ autoCalibrate: v })} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-md border border-border px-2.5 py-2">
            <span>
              <span className="block font-medium">Auto session</span>
              <span className="text-muted-foreground">Starts on the first hit or your own Fame reward.</span>
            </span>
            <Switch checked={s.settings.autoSession} onCheckedChange={(v) => set({ autoSession: v })} />
          </label>
        </div>
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Close the session after this much inactivity</span>
          <NativeSelect
            label="Inactivity time"
            value={String(s.settings.idleMinutes)}
            onChange={(v) => set({ idleMinutes: Number(v) })}
            className="h-7 w-24 text-xs"
          >
            {IDLE_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </NativeSelect>
        </label>
        {saveSettings.error && <p className="text-loss">{saveSettings.error.message}</p>}

        <Disclosure title="Manual calibration (advanced)">
          <ManualCalibration recording={s.recording} connected={s.capture.connected} />
        </Disclosure>
      </div>
    </Panel>
  );
}

/* ---------- main view ---------- */

export function DamageView() {
  const qc = useQueryClient();
  const stored = useSyncExternalStore(subscribeStorage, readStoredNames, () => null);
  const [draftNames, setDraftNames] = useState<string | null>(null);
  const names = draftNames ?? stored ?? "";
  const [onlyParty, setOnlyParty] = useState(false);
  const [label, setLabel] = useState("");
  const [openSession, setOpenSession] = useState<string | null>(null);

  const state = useQuery({
    queryKey: ["damage-state"],
    queryFn: ({ signal }) => damageApi.state(signal),
    refetchInterval: 1000,
    refetchIntervalInBackground: false,
  });
  const lastAutoSaveId = state.data?.lastAutoSave?.id ?? null;
  const sessions = useQuery({
    queryKey: ["damage-sessions", lastAutoSaveId],
    queryFn: ({ signal }) => damageApi.sessions(signal),
  });
  const detail = useQuery({
    queryKey: ["damage-session", openSession],
    queryFn: ({ signal }) => damageApi.session(openSession!, signal),
    enabled: openSession !== null,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["damage-state"] });
    void qc.invalidateQueries({ queryKey: ["damage-sessions"] });
  };
  const start = useMutation({ mutationFn: () => damageApi.control({ action: "session-start", label }), onSuccess: refresh });
  const stop = useMutation({
    mutationFn: () => damageApi.control({ action: "session-stop" }) as Promise<{ session: SessionRecord }>,
    onSuccess: (r) => {
      setLabel("");
      setOpenSession(r.session.id);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => damageApi.deleteSession(id),
    onSuccess: (_r, id) => {
      if (openSession === id) setOpenSession(null);
      refresh();
    },
  });

  const s = state.data;
  const nameList = parseNames(names);
  const partyFilter = onlyParty && nameList.length > 0 ? nameList : null;
  const onNamesChange = (v: string) => {
    setDraftNames(v);
    writeStoredNames(v);
  };

  return (
    <div className="pb-8">
      <PageHeader section="damage"
        title="Damage Meter"
        description="Damage, Healing and Damage Taken for the party; Fame, silver and runs for your own character. A session starts on the first hit or your own Fame reward."
      />
      <div className="space-y-3 px-3 lg:px-4">
        <div className="flex gap-2.5 rounded-lg border border-border bg-card p-3 text-xs leading-relaxed">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <p className="text-muted-foreground">
            The capture only reads packets the game <span className="text-foreground">receives</span> and forwards them to this app; the data stays
            on this computer. Sandbox Interactive is known to tolerate read-only tools, but that is not an official guarantee; use it at
            your own risk.
          </p>
        </div>

        {state.isPending ? (
          <Panel>
            <TableSkeleton rows={4} />
          </Panel>
        ) : state.isError ? (
          <Panel>
            <ErrorState error={state.error} onRetry={() => void state.refetch()} />
          </Panel>
        ) : (
          <>
            <div className="grid gap-3 xl:grid-cols-2">
              <AutomationPanel s={s!} />
              <ConnectionPanel s={s!} />
            </div>

            <Panel
              title={
                <span className="flex items-center gap-2">
                  <Play className="size-4 text-muted-foreground" /> Session
                  {s!.session && (
                    <Pill className="border-loss/40 text-loss">
                      <CircleDot className="size-3 animate-pulse" /> {s!.session.auto ? "Auto" : "Live"} ·{" "}
                      <span className="num">{formatDuration(s!.now - s!.session.startedAt)}</span>
                    </Pill>
                  )}
                </span>
              }
            >
              <div className="flex flex-wrap items-end gap-2 border-b border-border p-3">
                {s!.session ? (
                  <>
                    <p className="mr-auto text-xs text-muted-foreground">
                      <span className="text-foreground">{s!.session.label}</span>
                      {s!.session.auto && ` · saved automatically after ${s!.settings.idleMinutes} min without activity`}
                    </p>
                    <Button size="sm" variant="destructive" onClick={() => stop.mutate()} disabled={stop.isPending}>
                      {stop.isPending ? <Loader2 className="animate-spin" /> : <Square />} End and save now
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="mr-auto text-xs text-muted-foreground">
                      {s!.settings.autoSession
                        ? s!.config
                          ? "Waiting: a session starts by itself on the first hit or your own Fame reward."
                          : "A session starts by itself once your Fame reward or the damage event is recognised."
                        : "Auto session is off; start one manually."}
                    </p>
                    <label className="flex min-w-48 flex-col gap-1">
                      <FieldLabel>Session name (optional)</FieldLabel>
                      <Input
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        placeholder="e.g. T6 static – Undead"
                        className="h-8 text-[13px]"
                        maxLength={80}
                      />
                    </label>
                    <Button size="sm" variant="outline" onClick={() => start.mutate()} disabled={start.isPending || (!s!.config && !s!.capture.selfName)}>
                      {start.isPending ? <Loader2 className="animate-spin" /> : <Play />} Start manually
                    </Button>
                  </>
                )}
              </div>
              {(start.error || stop.error) && <p className="px-3 pt-2 text-xs text-loss">{(start.error ?? stop.error)!.message}</p>}
              {s!.session ? (
                <PlayerTable session={s!.session} now={s!.now} onlyNames={partyFilter} selfName={s!.capture.selfName} />
              ) : (
                <EmptyState title="No session running">
                  {s!.lastAutoSave
                    ? `The last session "${s!.lastAutoSave.label}" was saved; see the history below.`
                    : "Enter a dungeon and start fighting; the table fills in live here."}
                </EmptyState>
              )}
              <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2 text-xs">
                <Switch checked={onlyParty} onCheckedChange={setOnlyParty} size="sm" disabled={nameList.length === 0} />
                <span className="text-muted-foreground">Only show these names:</span>
                <Input
                  value={names}
                  onChange={(e) => onNamesChange(e.target.value)}
                  placeholder="Party members (comma-separated) — optional"
                  className="h-7 max-w-80 min-w-48 flex-1 text-xs"
                />
              </div>
            </Panel>

            <Panel
              title={
                <span className="flex items-center gap-2">
                  <History className="size-4 text-muted-foreground" /> Session history
                </span>
              }
            >
              {sessions.isPending ? (
                <TableSkeleton rows={3} />
              ) : sessions.isError ? (
                <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} />
              ) : sessions.data.sessions.length === 0 ? (
                <EmptyState title="No saved sessions">Finished sessions are listed here.</EmptyState>
              ) : (
                <ul className="divide-y divide-border">
                  {sessions.data.sessions.map((x) => {
                    const open = openSession === x.id;
                    return (
                      <li key={x.id}>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-xs">
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            onClick={() => setOpenSession(open ? null : x.id)}
                            aria-expanded={open}
                          >
                            <span className="block truncate text-[13px] font-medium">{x.label}</span>
                            <span className="text-muted-foreground">
                              {new Date(x.startedAt).toLocaleString("en-GB")} · {formatDuration((x.endedAt ?? x.startedAt) - x.startedAt)} ·{" "}
                              {x.playerCount} {x.playerCount === 1 ? "player" : "players"}
                            </span>
                          </button>
                          <span className="text-muted-foreground">
                            Damage <span className="num text-foreground">{formatCompact(x.totalDamage)}</span>
                            {(x.kills ?? 0) > 0 && <> · Kills <span className="num text-foreground">{x.kills}</span></>}
                            {x.fame && <> · Fame <span className="num text-foreground">{formatCompact(x.fame.total)}</span></>}
                            {x.silver && <> · Silver <span className="num text-foreground">{formatCompact(x.silver.net)}</span></>}
                            {x.balanceChange != null && x.balanceChange !== 0 && (
                              <> · Balance <span className="num text-foreground">{x.balanceChange > 0 ? "+" : ""}{formatCompact(x.balanceChange)}</span></>
                            )}
                            {(x.runCount ?? 0) > 1 && <> · {x.runCount} runs</>}
                            {x.topPlayer && (
                              <>
                                {" "}
                                · top <span className="text-foreground">{x.topPlayer}</span>
                              </>
                            )}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="Delete session"
                            onClick={() => {
                              if (window.confirm(`Permanently delete the session "${x.label}"?`)) remove.mutate(x.id);
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                        {open && (
                          <div className="border-t border-border bg-background/40">
                            {detail.isPending ? (
                              <TableSkeleton rows={3} />
                            ) : detail.isError ? (
                              <ErrorState error={detail.error} />
                            ) : (
                              <PlayerTable session={detail.data.session} now={s!.now} onlyNames={partyFilter} selfName={s!.capture.selfName} />
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>

            <p className="text-[11px] leading-relaxed text-muted-foreground/80">
              Numbers are the events received by the client running the capture: hits by party members out of view range may be
              missing. Pet/summon damage is shown separately as &quot;unattributed&quot;. Self-healing and
              PvP damage are not counted in the Damage total. Healing may include overhealing. Very short auto sessions (fewer than 10 hits)
              without a Fame reward or silver pickup are not saved. The Main Hand column shows the last seen equipment and updates when weapons change.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
