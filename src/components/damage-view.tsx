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
  Play,
  ShieldCheck,
  Square,
  Trash2,
  UserRound,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useState, useSyncExternalStore, type ReactNode } from "react";
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
import type { DamageConfig, DamageSettings, PlayerStats, SessionRecord } from "@/lib/damage/types";
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
        aria-label="Kopyala"
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
      <span lang="en" className="font-medium text-foreground">Personal Fame</span> · Bu oturumda kendi karakterine ait Fame kaydı yok.
      {!session.endedAt && " Yakalayıcı açıkken bölge değiştir; Fame kazandığında burada görünür."}
    </div>
  );
  const seconds = Math.max(1, ((session.endedAt ?? now) - session.startedAt) / 1000);
  const metrics = [
    ["Total Fame", formatSilver(fame.total)],
    ["Fame/hour", formatSilver(fame.total * 3600 / seconds)],
    ["Fame (zone incl.)", formatSilver(fame.zoneIncluded)],
    ["Premium bonus", formatSilver(fame.premium)],
    ["Satchel bonus", formatSilver(fame.satchel)],
    ["Bonus modifier (last)", fame.lastBonusPercent === null ? "Bilinmiyor" : `%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(fame.lastBonusPercent)}`],
  ];
  return (
    <div className="border-b border-border bg-fuchsia-500/5 px-3 py-3">
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span lang="en" className="font-medium">Personal Fame</span>
        <span className="font-medium text-fuchsia-300">{fame.name}</span>
        <span className="text-muted-foreground">· yalnızca bu oturumda alınan ödüller</span>
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
        Total Fame, zone dahil Fame ile Premium ve Satchel katkılarının toplamıdır.
        Bonus modifier son ödülde bildirilen orandır; Fame&apos;e zaten dahil olduğundan tekrar eklenmez.
        Buff adı ve kalan süresi bu kayıtta bulunmaz. Kayıt sırasında alınamayan ödüller dahil değildir.
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
        title="Main Hand, oyuncu bölgeye girerken ya da ekipman değiştirince öğrenilir. Yakalayıcıyı başlattıktan sonra bir kez bölge değiştir."
      >
        Bilinmiyor
      </span>
    );
  }
  const item = observation.item;
  if (!item) return <span lang="en" className="text-xs text-muted-foreground">Unarmed</span>;
  return (
    <div className="flex items-center gap-2" title={`Son görülen Main Hand: ${item.nameEn} · T${item.tier}.${item.enchant}`}>
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
      <FameSummary session={session} now={now} />
      <EmptyState title={session.endedAt !== null ? "Damage kaydı yok" : "Henüz damage yok"}>
        {session.endedAt !== null ? "Bu oturumda eşleşen Damage kaydı bulunmuyor." :
          "Oturum açık; vuruşlar geldikçe burada görünür. Bir oyuncunun adı çıkmıyorsa, o oyuncu bölgeye girdiğinde yakalayıcının çalışıyor olması gerekir (isimler bölgeye girişte gelir)."}
      </EmptyState>
      </>
    );
  }

  return (
    <>
    <FameSummary session={session} now={now} />
    <div className="overflow-x-auto">
      <table className="w-full min-w-[840px] text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] tracking-wide text-muted-foreground uppercase">
            <th className="px-3 py-2 font-medium">Oyuncu</th>
            <th lang="en" className="px-3 py-2 font-medium">
              <WithTip tip="Son görülen Main Hand. Ekipman paketi geldikçe güncellenir.">Main Hand</WithTip>
            </th>
            <th lang="en" className="px-3 py-2 text-right font-medium">Damage</th>
            <th className="w-[28%] px-3 py-2 font-medium">Pay</th>
            <th lang="en" className="px-3 py-2 text-right font-medium">DPS</th>
            <th lang="en" className="px-3 py-2 text-right font-medium">Healing</th>
            <th lang="en" className="px-3 py-2 text-right font-medium">Damage Taken</th>
            <th lang="en" className="px-3 py-2 text-right font-medium">Hits</th>
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
                  {isSelf && <span className="ml-1.5 text-[11px] text-fuchsia-300">sen</span>}
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
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-xs text-muted-foreground">
        <span>
          Süre <span className="num text-foreground">{formatDuration(end - session.startedAt)}</span>
        </span>
        <span>
          Toplam Damage <span className="num text-foreground">{formatSilver(total)}</span>
        </span>
        <span>
          Party DPS <span className="num text-foreground">{formatSilver(total / seconds)}</span>
        </span>
        {session.unattributedDamage > 0 && (
          <span title="Sahibi eşleşmeyen damage: pet/summon veya adı yakalanmadan önce bölgeye girmiş oyuncular.">
            Eşleşmeyen <span className="num text-foreground">{formatSilver(session.unattributedDamage)}</span>
          </span>
        )}
      </div>
    </div>
    </>
  );
}

/* ---------- connection ---------- */

const LAUNCHER_TEXT: Record<DamageState["launcher"]["state"], string> = {
  idle: "Kapalı",
  starting: "Başlatılıyor…",
  running: "Çalışıyor",
  stopping: "Durduruluyor…",
  denied: "İzin verilmedi",
  error: "Başlatılamadı",
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
          {busy ? <Loader2 className="animate-spin" /> : <Square />} Durdur
        </Button>
      ) : (
        <Button size="lg" onClick={() => start.mutate()} disabled={busy} className="min-w-36 bg-fuchsia-500 text-white hover:bg-fuchsia-400">
          {busy ? <Loader2 className="animate-spin" /> : <Play />} Başlat
        </Button>
      )}
      <div className="min-w-0 flex-1 text-xs leading-relaxed">
        <p className="font-medium">{LAUNCHER_TEXT[l.state]}</p>
        <p className="text-muted-foreground">
          {l.message ??
            (l.state === "running"
              ? "Oyun trafiği okunuyor. Uygulamayı kapatınca kendiliğinden durur."
              : "Başlat'a bas; Windows bir kez izin soracak, “Evet” de.")}
        </p>
        {error && <p className="text-loss">{error.message}</p>}
      </div>
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
          Yakalayıcı
        </span>
      }
      actions={
        c.connected ? (
          <Pill className="border-profit/30 text-profit">
            Bağlı · <span className="num">{c.packetsPerSecond}</span> paket/sn
          </Pill>
        ) : (
          <Pill className="border-border text-muted-foreground">Bekleniyor</Pill>
        )
      }
    >
      <div className="space-y-3 p-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Paket</dt>
            <dd className="num">{formatSilver(c.packetsReceived)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Mesaj</dt>
            <dd className="num">{formatSilver(c.decode.messages)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Tanınan oyuncu</dt>
            <dd className="num">{c.identitiesKnown}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Çözülemeyen</dt>
            <dd className="num">{c.decode.errors + c.decode.encrypted}</dd>
          </div>
        </dl>
        {desktop && <LauncherControl s={s} />}
        {!desktop && (
          <Disclosure title="Kurulum (Windows)" defaultOpen={!c.connected && c.packetsReceived === 0}>
          <ol className="space-y-3">
            <Step n={1}>
              <p>
                <code className="num">{CAPTURE_SOURCE}</code> dosyasını Windows bilgisayarına kopyala. Tek dosya; okuyup ne yaptığını
                görebilirsin.
              </p>
            </Step>
            <Step n={2}>
              <p>Aynı klasörde PowerShell aç ve Windows&apos;un kendi derleyicisiyle derle (indirme gerekmez):</p>
              <CopyLine text={COMPILE_CMD} />
            </Step>
            <Step n={3} done={c.connected}>
              <p>
                PowerShell&apos;i yönetici olarak açıp, oyun açıkken aynı klasörde çalıştır. Baştaki <code className="num">.\</code>{" "}
                PowerShell için gerekli:
              </p>
              {s.ingestUrls.length === 0 ? (
                <p className="text-warn">Bu bilgisayarın yerel ağ adresi bulunamadı.</p>
              ) : (
                s.ingestUrls.map((u) => <CopyLine key={u} text={`.\\AlbionCapture.exe ${u}`} />)
              )}
              <p className="text-muted-foreground">
                Uygulama aynı Windows bilgisayarında çalışıyorsa adres <code className="num">http://localhost:3100</code> olur.
              </p>
            </Step>
          </ol>
          </Disclosure>
        )}
        {c.decode.lastError && c.decode.errors > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Son çözme hatası: <span className="num">{c.decode.lastError}</span>
          </p>
        )}
      </div>
    </Panel>
  );
}

/* ---------- automation + calibration ---------- */

function autoStatusText(s: DamageState): { tone: "ok" | "wait" | "off"; text: string } {
  if (!s.settings.autoCalibrate && !s.config) return { tone: "off", text: "Otomatik kalibrasyon kapalı; aşağıdan elle yapabilirsin." };
  if (s.config && s.auto.state === "stale") return { tone: "wait", text: s.auto.note };
  if (s.config) {
    const when = new Date(s.config.calibratedAt).toLocaleString("tr-TR");
    const how = s.config.source === "auto" ? "otomatik" : "elle";
    return { tone: "ok", text: `Damage olayı tanındı (${how}, ${when}). Yamadan sonra bozulursa kendiliğinden yenilenir.` };
  }
  if (s.auto.state === "waiting") return { tone: "wait", text: s.auto.note };
  return { tone: "wait", text: "Bir mob'a vurduğunda damage olayı otomatik bulunacak." };
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
        Otomatik bulma bir şeyi yanlış tanırsa kullan: kayıt al, bir mob&apos;a vur, adayları oyunda gördüğün damage değerleriyle karşılaştır.
      </p>
      <label className="block space-y-1">
        <FieldLabel>Karakter adları (isteğe bağlı)</FieldLabel>
        <Input value={names} onChange={(e) => setNames(e.target.value)} placeholder="Boş bırakırsan otomatik bulunur" className="h-8 text-[13px]" />
      </label>
      {recording ? (
        <div className="flex flex-wrap items-center gap-2">
          <Pill className="border-loss/40 text-loss">
            <CircleDot className="size-3 animate-pulse" /> Kayıt · <span className="num">{recording.packets}</span> paket
          </Pill>
          <Button size="sm" onClick={() => stopAndAnalyze.mutate()} disabled={stopAndAnalyze.isPending}>
            {stopAndAnalyze.isPending ? <Loader2 className="animate-spin" /> : <Square />} Durdur ve analiz et
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => startRec.mutate()} disabled={startRec.isPending || !connected}>
          <Circle className="text-loss" /> Kaydı başlat
        </Button>
      )}

      {result &&
        (result.health.length === 0 ? (
          <p className="text-warn">
            Kayıtta damage olayı bulunamadı ({result.packets} paket). Kayıt sırasında bölge değiştirip bir mob&apos;a vurduğundan emin ol.
            {result.namesMissing.length > 0 && ` Kayıtta geçmeyen isimler: ${result.namesMissing.join(", ")}.`}
          </p>
        ) : (
          <div className="space-y-2">
            <div className="space-y-1.5" role="radiogroup" aria-label="Damage olayı adayları">
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
                        neden {h.rule.causerKey} · değişim {h.rule.changeKey}
                        {h.rule.targetKey === null ? "" : ` · hedef ${h.rule.targetKey}`}
                      </span>
                      {idx === 0 && <Pill className="border-primary/40 text-primary">Önerilen</Pill>}
                      <span className="text-muted-foreground">
                        {h.damageRows} vuruş · {h.subjectMobRows} mob&apos;a
                      </span>
                    </span>
                    <span className="block text-muted-foreground">
                      Örnek damage değerleri: <span className="num text-foreground">{h.sampleDamage.join(", ")}</span>
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
                {save.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Bu adayı kaydet
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setResult(null)}>
                Vazgeç
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
          <Bot className="size-4 text-muted-foreground" /> Otomasyon
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
              Sıfırla
            </Button>
          )}
        </div>
        {!s.capture.selfName && s.config && (
          <p className="text-muted-foreground">Kendi adın bir sonraki bölge değişiminde tanınır.</p>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded-md border border-border px-2.5 py-2">
            <span>
              <span className="block font-medium">Otomatik kalibrasyon</span>
              <span className="text-muted-foreground">Damage olayını canlı trafikten bulur.</span>
            </span>
            <Switch checked={s.settings.autoCalibrate} onCheckedChange={(v) => set({ autoCalibrate: v })} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-md border border-border px-2.5 py-2">
            <span>
              <span className="block font-medium">Otomatik oturum</span>
              <span className="text-muted-foreground">İlk vuruşta veya kendi Fame ödülünde başlar.</span>
            </span>
            <Switch checked={s.settings.autoSession} onCheckedChange={(v) => set({ autoSession: v })} />
          </label>
        </div>
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Oturumu kapatmak için sessizlik süresi</span>
          <NativeSelect
            label="Sessizlik süresi"
            value={String(s.settings.idleMinutes)}
            onChange={(v) => set({ idleMinutes: Number(v) })}
            className="h-7 w-24 text-xs"
          >
            {IDLE_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m} dk
              </option>
            ))}
          </NativeSelect>
        </label>
        {saveSettings.error && <p className="text-loss">{saveSettings.error.message}</p>}

        <Disclosure title="Elle kalibrasyon (gelişmiş)">
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
        description="Party için Damage, Healing ve Damage Taken; kendi karakterin için Fame ve bonus dökümü. Oturum ilk vuruşta veya kendi Fame ödülünde başlar."
      />
      <div className="space-y-3 px-3 lg:px-4">
        <div className="flex gap-2.5 rounded-lg border border-border bg-card p-3 text-xs leading-relaxed">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <p className="text-muted-foreground">
            Yakalayıcı yalnızca oyunun <span className="text-foreground">aldığı</span> paketleri okur ve bu uygulamaya iletir; veriler bu
            bilgisayardaki <code className="num">.data/damage</code> klasöründe kalır. Sandbox Interactive&apos;in yalnızca okuyan araçlara
            göz yumduğu bilinse de bu resmi bir garanti değildir; kullanım riski sana aittir.
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
                  <Play className="size-4 text-muted-foreground" /> Oturum
                  {s!.session && (
                    <Pill className="border-loss/40 text-loss">
                      <CircleDot className="size-3 animate-pulse" /> {s!.session.auto ? "Otomatik" : "Canlı"} ·{" "}
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
                      {s!.session.auto && ` · ${s!.settings.idleMinutes} dk etkinlik olmazsa kendiliğinden kaydedilir`}
                    </p>
                    <Button size="sm" variant="destructive" onClick={() => stop.mutate()} disabled={stop.isPending}>
                      {stop.isPending ? <Loader2 className="animate-spin" /> : <Square />} Şimdi bitir ve kaydet
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="mr-auto text-xs text-muted-foreground">
                      {s!.settings.autoSession
                        ? s!.config
                          ? "Bekleniyor: ilk vuruşta veya kendi Fame ödülünde oturum kendiliğinden başlar."
                          : "Kendi Fame ödülün veya Damage olayı tanındığında oturum kendiliğinden başlar."
                        : "Otomatik oturum kapalı; elle başlat."}
                    </p>
                    <label className="flex min-w-48 flex-col gap-1">
                      <FieldLabel>Oturum adı (isteğe bağlı)</FieldLabel>
                      <Input
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        placeholder="Örn: T6 static – Undead"
                        className="h-8 text-[13px]"
                        maxLength={80}
                      />
                    </label>
                    <Button size="sm" variant="outline" onClick={() => start.mutate()} disabled={start.isPending || (!s!.config && !s!.capture.selfName)}>
                      {start.isPending ? <Loader2 className="animate-spin" /> : <Play />} Elle başlat
                    </Button>
                  </>
                )}
              </div>
              {(start.error || stop.error) && <p className="px-3 pt-2 text-xs text-loss">{(start.error ?? stop.error)!.message}</p>}
              {s!.session ? (
                <PlayerTable session={s!.session} now={s!.now} onlyNames={partyFilter} selfName={s!.capture.selfName} />
              ) : (
                <EmptyState title="Çalışan oturum yok">
                  {s!.lastAutoSave
                    ? `Son oturum "${s!.lastAutoSave.label}" kaydedildi; aşağıdaki geçmişte.`
                    : "Static'e girip savaşmaya başladığında tablo burada canlı dolar."}
                </EmptyState>
              )}
              <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2 text-xs">
                <Switch checked={onlyParty} onCheckedChange={setOnlyParty} size="sm" disabled={nameList.length === 0} />
                <span className="text-muted-foreground">Yalnızca şu isimleri göster:</span>
                <Input
                  value={names}
                  onChange={(e) => onNamesChange(e.target.value)}
                  placeholder="Party üyeleri (virgülle) — isteğe bağlı"
                  className="h-7 max-w-80 min-w-48 flex-1 text-xs"
                />
              </div>
            </Panel>

            <Panel
              title={
                <span className="flex items-center gap-2">
                  <History className="size-4 text-muted-foreground" /> Geçmiş oturumlar
                </span>
              }
            >
              {sessions.isPending ? (
                <TableSkeleton rows={3} />
              ) : sessions.isError ? (
                <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} />
              ) : sessions.data.sessions.length === 0 ? (
                <EmptyState title="Kayıtlı oturum yok">Biten oturumlar burada listelenir.</EmptyState>
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
                              {new Date(x.startedAt).toLocaleString("tr-TR")} · {formatDuration((x.endedAt ?? x.startedAt) - x.startedAt)} ·{" "}
                              {x.playerCount} oyuncu
                            </span>
                          </button>
                          <span className="text-muted-foreground">
                            Damage <span className="num text-foreground">{formatCompact(x.totalDamage)}</span>
                            {x.fame && <> · Fame <span className="num text-foreground">{formatCompact(x.fame.total)}</span></>}
                            {x.topPlayer && (
                              <>
                                {" "}
                                · en yüksek <span className="text-foreground">{x.topPlayer}</span>
                              </>
                            )}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="Oturumu sil"
                            onClick={() => {
                              if (window.confirm(`"${x.label}" oturumu kalıcı olarak silinsin mi?`)) remove.mutate(x.id);
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
              Sayılar, yakalayıcının çalıştığı oyuncunun istemcisine gelen olaylardır: görüş menzili dışındaki party üyelerinin vuruşları
              eksik olabilir. Pet/summon damage&apos;i &quot;eşleşmeyen&quot; olarak ayrı gösterilir. Self-healing ve
              PvP damage, Damage toplamına sayılmaz. Healing, overhealing içerebilir. Fame ödülü olmayan çok kısa (10 vuruştan az)
              otomatik oturumlar kaydedilmez. Main Hand sütunu son görülen ekipmanı gösterir; silah değiştikçe güncellenir.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
