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
  Settings2,
  ShieldCheck,
  Square,
  Swords,
  Trash2,
  UserRound,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Pill } from "@/components/badges";
import { LootPanel } from "@/components/damage-loot";
import { PlayerTable } from "@/components/damage-player-table";
import { NativeSelect } from "@/components/filters-bar";
import { PageHeader, Panel } from "@/components/page-parts";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { configFor } from "@/lib/damage/calibrate";
import { damageApi, formatDuration, type CalibrationResponse } from "@/lib/damage/client-api";
import { playerRanking, sessionSeconds } from "@/lib/damage/presentation";
import type { DamageState } from "@/lib/damage/service";
import { sessionKills, type DamageConfig, type DamageSettings, type SessionRecord } from "@/lib/damage/types";
import { zoneLabel } from "@/lib/damage/zone";
import { desktopApi, OVERLAY_LOCK_KEYS, OVERLAY_TOGGLE_KEYS } from "@/lib/desktop";
import { formatCompact, formatSilver } from "@/lib/format";
import { cn } from "@/lib/utils";

const CAPTURE_SOURCE = "tools/albion-capture/AlbionCapture.cs";
const COMPILE_CMD = String.raw`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /out:AlbionCapture.exe AlbionCapture.cs`;
const IDLE_OPTIONS = [2, 3, 5, 10, 15];

/* ---------- small helpers ---------- */


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
      <span lang="en" className="font-medium text-foreground">Combat Fame</span> · No Fame for your character in this session.
      {!session.endedAt && " Change zones while the capture is running; Fame shows up here as you earn it."}
    </div>
  );
  const seconds = Math.max(1, ((session.endedAt ?? now) - session.startedAt) / 1000);
  const kills = sessionKills(session);
  const metrics = [
    ["Combat Fame", formatSilver(fame.total)],
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
        <span lang="en" className="font-medium">Combat Fame</span>
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
        Combat Fame is the zone-included Fame plus the Premium and Satchel contributions.
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
    ["Received", formatSilver(silver.net)],
    ["Silver/hour", formatSilver(silver.net * 3600 / seconds)],
    ...(kills > 0 ? [["Silver/kill", formatSilver(silver.net / kills)]] : []),
    ["Shares", String(silver.pickups)],
    // Sessions saved before party shares were counted only had your own pickups, with their tax.
    ...(silver.tax !== undefined ? [["Tax", formatSilver(silver.tax)]] : []),
  ];
  return (
    <div className="border-b border-border bg-amber-500/5 px-3 py-3">
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span lang="en" className="font-medium">Silver</span>
        <span className="font-medium text-amber-300">{silver.name}</span>
        <span className="text-muted-foreground">· received in this session only</span>
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
        Received is the silver that reached your bag after tax: every pickup when solo, your share of every pickup in a party
        (the Silver column shows each member&apos;s share). Sales, purchases and repairs are not included.
      </p>
    </div>
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

/** Desktop app: one Start/Stop button for the capture instead of terminal instructions. */
function LauncherControl({ s }: { s: DamageState }) {
  const qc = useQueryClient();
  const l = s.launcher;
  const invalidate = () => qc.invalidateQueries({ queryKey: ["damage-state"] });
  const start = useMutation({ mutationFn: () => damageApi.control({ action: "capture-start" }), onSuccess: invalidate });
  const stop = useMutation({ mutationFn: () => damageApi.control({ action: "capture-stop" }), onSuccess: invalidate });
  const active = l.state === "running" || l.state === "starting";
  const busy = start.isPending || stop.isPending || l.state === "starting" || l.state === "stopping";
  const error = start.error ?? stop.error;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant={active ? "outline" : "default"} onClick={() => (active ? stop.mutate() : start.mutate())} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : active ? <Square /> : <Play />}
        {l.state === "starting" ? "Starting…" : l.state === "stopping" ? "Stopping…" : active ? "Stop tracking" : "Start tracking"}
      </Button>
      {error && <p role="alert" className="max-w-sm text-xs text-loss">{error.message}</p>}
    </div>
  );
}

/** The desktop bridge is there from the first render and never changes. */
const subscribeNothing = () => () => {};

/** Desktop app only: whether the always-on-top in-game overlay exists and is open. */
function useOverlay() {
  const available = useSyncExternalStore(subscribeNothing, () => desktopApi() !== null, () => false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const api = desktopApi();
    if (!api) return;
    void api.overlay.isOpen().then(setOpen);
    return api.overlay.onOpenChange(setOpen);
  }, []);
  return { available, open };
}

function OverlayButton() {
  const { available, open } = useOverlay();
  if (!available) return null;
  return (
    <Button variant="ghost" onClick={() => desktopApi()?.overlay.toggle()} title={`${OVERLAY_TOGGLE_KEYS} shows or hides it, ${OVERLAY_LOCK_KEYS} locks it`}>
      <PictureInPicture2 /> {open ? "Hide overlay" : "Show overlay"}
    </Button>
  );
}

/** Desktop app only: the overlay toggle with its explanation, for the settings sheet. */
function OverlayControl() {
  const { available, open } = useOverlay();
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
  const [result, setResult] = useState<CalibrationResponse | null>(null);
  const [choice, setChoice] = useState(0);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["damage-state"] });

  const startRec = useMutation({ mutationFn: () => damageApi.control({ action: "recording-start" }), onSuccess: invalidate });
  const stopAndAnalyze = useMutation({
    mutationFn: async () => {
      await damageApi.control({ action: "recording-stop" });
      return damageApi.calibrate();
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
        Only needed if a game patch moves the damage event: record while changing zones and hitting a mob, then compare the
        candidates with the damage numbers you saw in game. Player names always come from zone entry, never from here.
      </p>
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
            {result.playersFound.length === 0 && " No player was announced in it: start recording before changing zones."}
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

function TrackingNotice({ s, onSettings }: { s: DamageState; onSettings: () => void }) {
  const failed = s.launcher.available && (s.launcher.state === "error" || s.launcher.state === "denied");
  const closed = s.launcher.available && s.launcher.state === "idle" && !s.capture.connected;
  let message: string | null = null;
  if (failed) message = s.launcher.message ?? "The capture could not start. Start tracking again or check the connection settings.";
  else if (closed) message = "Tracking is off. Start tracking; Windows may ask for administrator permission.";
  else if (!s.capture.connected) message = s.capture.lastPacketAt
    ? "The data stream stopped. Check that the game is open and the capture is running."
    : "Waiting for game data. Open Albion Online and change zones while the capture is running.";
  else if (!s.config || s.auto.state === "stale") message = autoStatusText(s).text;
  else if (!s.capture.selfName) message = "Change zones while the capture is running to recognise your character. The damage ranking already works.";
  if (!message) return null;
  const action = !s.launcher.available || failed || (s.capture.connected && !s.config && !s.settings.autoCalibrate);
  return (
    <div role="status" className={cn("flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm", failed ? "border-loss/30 text-loss" : "border-warn/25 text-muted-foreground")}>
      <span>{message}</span>
      {action && <Button variant="ghost" size="sm" onClick={onSettings}>{!s.launcher.available ? "Connection setup" : "Open settings"}</Button>}
    </div>
  );
}

/* ---------- main view ---------- */

/** Headline numbers of a session (live or saved): damage for the table's scope, your own Combat Fame and silver. */
function SessionKpis({ session, now, partyOnly, selfName }: { session: SessionRecord; now: number; partyOnly: boolean; selfName: string | null }) {
  const scope = partyOnly && session.party ? session.party : null;
  const total = playerRanking(session, "damage", scope).total;
  const seconds = sessionSeconds(session, now);
  const self = selfName ? session.players.find((p) => p.name.toLowerCase() === selfName.toLowerCase()) : undefined;
  const fame = session.fame?.total ?? 0;
  const silver = session.silver?.net ?? 0;
  const perHour = (value: number) => `${formatCompact(value * 3600 / seconds)} per hour`;
  const items = [
    { label: "Total Damage", value: formatCompact(total), note: scope ? "Party members" : "Everyone in view" },
    { label: "Session DPS", value: formatCompact(total / seconds), note: "Idle time included" },
    { label: "Your DPS", value: self ? formatCompact(self.damage / seconds) : "—", note: selfName ?? "Character not recognised yet" },
    { label: "Combat Fame", value: fame > 0 ? formatCompact(fame) : "—", note: fame > 0 ? perHour(fame) : "No Fame reward yet", tone: "text-fuchsia-300" },
    { label: "Silver", value: silver > 0 ? formatCompact(silver) : "—", note: silver > 0 ? `${perHour(silver)} · your share` : "No silver pickup yet", tone: "text-amber-300" },
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 rounded-lg border border-border bg-card px-3 py-2">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className={cn("num mt-1 text-xl font-semibold sm:text-2xl", item.tone)}>{item.value}</dd>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">{item.note}</p>
        </div>
      ))}
    </dl>
  );
}

/** Fame, silver and per-zone runs in detail; folded away so the player table stays in view. */
function EarningsDetails({ session, now }: { session: SessionRecord; now: number }) {
  return (
    <Disclosure title="Fame, silver and runs in detail">
      <div className="-m-2.5">
        <FameSummary session={session} now={now} />
        <SilverSummary session={session} now={now} />
        <RunsSummary session={session} now={now} />
      </div>
    </Disclosure>
  );
}

export function DamageView() {
  const qc = useQueryClient();
  const [partyOnly, setPartyOnly] = useState(true);
  const [label, setLabel] = useState("");
  const [tab, setTab] = useState<string>("live");
  const [settingsOpen, setSettingsOpen] = useState(false);
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
      setTab("history");
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
  const session = s?.session;
  const filters = (
    <label className="flex items-center gap-2 text-sm" title="Hide other players in view. The party comes from the game itself, at every zone entry.">
      <Switch checked={partyOnly} onCheckedChange={setPartyOnly} size="sm" />
      Party only
    </label>
  );

  return (
    <div className="pb-8">
      <PageHeader section="damage" title="Damage Meter" description="Track your live performance and the player ranking." />
      <div className="space-y-3 px-3 lg:px-4">
        {state.isPending ? <Panel><TableSkeleton rows={5} /></Panel> : state.isError ? (
          <Panel><ErrorState title="Could not load Damage Meter data" error={state.error} onRetry={() => void state.refetch()} /></Panel>
        ) : s ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <span className="flex items-center gap-1.5">
                  {s.capture.connected ? <Wifi className="size-4 text-profit" /> : <WifiOff className="size-4 text-warn" />}
                  {s.capture.connected ? "Receiving data" : s.capture.lastPacketAt ? "Data stream stopped" : "Waiting for game data"}
                </span>
                <span className="text-xs text-muted-foreground">Capture: {s.launcher.available ? LAUNCHER_TEXT[s.launcher.state] : "External"}</span>
                {s.capture.selfName && <span className="flex items-center gap-1.5 text-fuchsia-300"><UserRound className="size-3.5" />{s.capture.selfName}</span>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {s.launcher.available && <LauncherControl s={s} />}
                <OverlayButton />
                <Button variant="ghost" onClick={() => setSettingsOpen(true)}><Settings2 />Settings</Button>
              </div>
            </div>
            <TrackingNotice s={s} onSettings={() => setSettingsOpen(true)} />

            <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
              <SheetContent showCloseButton={false} className="w-full gap-4 overflow-y-auto p-4 sm:max-w-xl [&>*]:shrink-0">
                <SheetClose className="absolute top-3 right-3 rounded-md p-2 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                  <X className="size-4" /><span className="sr-only">Close settings</span>
                </SheetClose>
                <div className="pr-9">
                  <SheetTitle>Damage Meter settings</SheetTitle>
                  <SheetDescription>Automation, connection, overlay and advanced calibration.</SheetDescription>
                </div>
                <AutomationPanel s={s} />
                <ConnectionPanel s={s} />
                <div className="flex gap-2 rounded-lg border border-border p-3 text-xs leading-relaxed text-muted-foreground">
                  <ShieldCheck className="size-4 shrink-0 text-primary" />
                  <p>The capture only reads packets the game receives and forwards them to this app; the data stays on this computer.
                    Sandbox Interactive is known to tolerate read-only tools, but that is not an official guarantee; use it at your own risk.</p>
                </div>
                <Disclosure title="What is measured and how">
                  <p className="text-xs leading-relaxed text-muted-foreground">Numbers are the events received by the client running the capture:
                    hits by party members out of view range may be missing. Pet/summon damage is shown separately as unknown players.
                    Self-healing and PvP damage are not counted in the Damage total. Healing may include overhealing. Very short auto sessions
                    (fewer than 10 hits) without a Fame reward or silver pickup are not saved. Main Hand is the last seen equipment;
                    Damage is not split by weapon.</p>
                </Disclosure>
              </SheetContent>
            </Sheet>

            <Tabs value={tab} onValueChange={(value) => setTab(String(value))} className="gap-3">
              <TabsList className="h-10 w-full sm:w-fit">
                <TabsTrigger value="live" className="px-5"><Swords />Live</TabsTrigger>
                <TabsTrigger value="history" className="px-5"><History />History</TabsTrigger>
              </TabsList>
              <TabsContent value="live" className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
                  {session ? (
                    <>
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          <span className="truncate">{session.label}</span>
                          <Pill className="border-profit/30 text-profit"><CircleDot className="size-3" />{session.auto ? "Auto" : "Live"}</Pill>
                          <span className="num text-sm text-muted-foreground">{formatDuration(s.now - session.startedAt)}</span>
                        </p>
                        {session.auto && <p className="mt-1 text-xs text-muted-foreground">Saved automatically after {s.settings.idleMinutes} min without activity.</p>}
                      </div>
                      <Button variant="outline" onClick={() => stop.mutate()} disabled={stop.isPending}>
                        {stop.isPending ? <Loader2 className="animate-spin" /> : <Square />}End and save session
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">
                        {s.settings.autoSession ? "A session starts by itself on the first hit or your own Fame reward." : "Auto session is off; start one manually."}
                      </p>
                      <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                        <Input aria-label="Session name (optional)" value={label} onChange={(e) => setLabel(e.target.value)}
                          placeholder="Session name (optional)" maxLength={80} className="w-full sm:w-56" />
                        <Button variant="outline" onClick={() => start.mutate()} disabled={start.isPending || (!s.config && !s.capture.selfName)}>
                          {start.isPending ? <Loader2 className="animate-spin" /> : <Play />}Start manually
                        </Button>
                      </div>
                    </>
                  )}
                </div>
                {(start.error || stop.error) && <p role="alert" className="text-sm text-loss">{(start.error ?? stop.error)!.message}</p>}
                {session && <SessionKpis session={session} now={s.now} partyOnly={partyOnly} selfName={s.capture.selfName} />}
                <Panel>
                  {session ? (
                    <PlayerTable key={session.id} session={session} now={s.now} partyOnly={partyOnly} selfName={s.capture.selfName} onShowAll={() => setPartyOnly(false)} toolbar={filters} />
                  ) : (
                    <EmptyState title="Waiting for a session">
                      {s.lastAutoSave ? (
                        <div className="space-y-3">
                          <p>The last session “{s.lastAutoSave.label}” was saved.</p>
                          <Button variant="outline" onClick={() => { setOpenSession(s.lastAutoSave!.id); setTab("history"); }}>View in History</Button>
                        </div>
                      ) : "Enter a dungeon and start fighting; the player ranking fills in live here."}
                    </EmptyState>
                  )}
                </Panel>
                {session && <LootPanel session={session} partyOnly={partyOnly} selfName={s.capture.selfName} />}
                {session && <EarningsDetails session={session} now={s.now} />}
              </TabsContent>
              <TabsContent value="history">
                {remove.error && <p role="alert" className="mb-3 text-sm text-loss">{remove.error.message}</p>}
                <Panel
                  title={
                    <span className="flex items-center gap-2">
                      <History className="size-4 text-muted-foreground" /> Session history
                    </span>
                  }
                >
                  <div className="border-b border-border p-3">{filters}</div>
                  {sessions.isPending ? (
                    <TableSkeleton rows={3} />
                  ) : sessions.isError ? (
                    <ErrorState title="Could not load saved sessions" error={sessions.error} onRetry={() => void sessions.refetch()} />
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
                                disabled={remove.isPending}
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
                                  <ErrorState title="Could not load the session" error={detail.error} onRetry={() => void detail.refetch()} />
                                ) : (
                                  <>
                                    <div className="p-3">
                                      <SessionKpis
                                        session={detail.data.session}
                                        now={s.now}
                                        partyOnly={partyOnly}
                                        selfName={detail.data.session.fame?.name ?? detail.data.session.silver?.name ?? s.capture.selfName}
                                      />
                                    </div>
                                    <PlayerTable
                                      key={detail.data.session.id}
                                      session={detail.data.session}
                                      now={s.now}
                                      partyOnly={partyOnly}
                                      selfName={detail.data.session.fame?.name ?? detail.data.session.silver?.name ?? s.capture.selfName}
                                      onShowAll={() => setPartyOnly(false)}
                                    />
                                    <div className="space-y-3 p-3">
                                      <LootPanel
                                        session={detail.data.session}
                                        partyOnly={partyOnly}
                                        selfName={detail.data.session.fame?.name ?? detail.data.session.silver?.name ?? s.capture.selfName}
                                      />
                                      <EarningsDetails session={detail.data.session} now={s.now} />
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Panel>
              </TabsContent>
            </Tabs>
            <p className="text-xs text-muted-foreground">Only events the client sees are measured; scope and usage notes are in Settings.</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
