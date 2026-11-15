"use client";

import { Check, RotateCcw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { NativeSelect } from "@/components/filters-bar";
import { PageHeader, Panel } from "@/components/page-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-settings";
import { ROYAL_CITIES, SERVERS, SERVER_IDS, type City, type ServerId } from "@/lib/albion/constants";
import { formatCompact } from "@/lib/format";
import { DEFAULT_FEES, FEE_ASSUMPTION_NOTE } from "@/lib/profit/fees";
import { RISK_PREFERENCES, RISK_PREFERENCE_LABELS, settingsSchema, type RiskPreference, type Settings } from "@/lib/settings/schema";
import { cn } from "@/lib/utils";

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 border-b border-border/60 px-3 py-2.5 last:border-b-0 sm:grid-cols-[14rem_1fr] sm:items-center">
      <div>
        <div className="text-[13px]">{label}</div>
        {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function NumInput({
  value,
  onChange,
  suffix,
  scale = 1,
  allowEmpty,
  width = "w-40",
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  suffix?: string;
  scale?: number;
  allowEmpty?: boolean;
  width?: string;
}) {
  const [text, setText] = useState(value === null ? "" : String(Math.round(value * scale * 1000) / 1000));
  return (
    <div className="relative">
      <Input
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const t = e.target.value.trim().replace(/\./g, "").replace(",", ".");
          if (t === "" && allowEmpty) return onChange(null);
          const n = Number(t);
          if (t !== "" && Number.isFinite(n)) onChange(n / scale);
        }}
        className={cn("num h-8 pr-9 text-[13px]", width)}
      />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
    </div>
  );
}

export function SettingsView() {
  const { settings, hydrated, update, reset } = useSettings();
  if (!hydrated) return <PageHeader section="settings" title="Ayarlar" description="Yükleniyor…" />;
  // Re-mount the form when stored settings change (e.g. after reset) so the draft starts from them.
  return <SettingsForm key={JSON.stringify(settings)} initial={settings} onSave={update} onReset={reset} />;
}

function SettingsForm({ initial, onSave, onReset }: { initial: Settings; onSave: (s: Settings) => void; onReset: () => void }) {
  const [draft, setDraft] = useState<Settings>(initial);
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<Settings>) => {
    setSaved(false);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const setFees = (patch: Partial<Settings["fees"]>) => set({ fees: { ...draft.fees, ...patch } });

  const parsed = settingsSchema.safeParse(draft);
  const errors: string[] = [];
  if (!parsed.success) errors.push(...parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  if (draft.tradeBudget > draft.totalSilver) errors.push("Ticaret bütçesi toplam silver'dan büyük olamaz.");
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  return (
    <div className="pb-6">
      <PageHeader section="settings"
        title="Ayarlar"
        description="Ayarlar yalnızca bu tarayıcıda (localStorage) saklanır. Hesaplamalar bu değerlerle sunucuda yapılır."
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={onReset}>
              <RotateCcw /> Varsayılanlar
            </Button>
            <Button
              size="sm"
              disabled={!dirty || errors.length > 0}
              onClick={() => {
                if (parsed.success) {
                  onSave(parsed.data);
                  setSaved(true);
                }
              }}
            >
              <Check /> Kaydet
            </Button>
          </>
        }
      />
      <div className="max-w-4xl space-y-3 px-3 lg:px-4">
        {errors.length > 0 && (
          <div className="rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-xs text-loss" role="alert">
            {errors.map((e) => (
              <div key={e}>{e}</div>
            ))}
          </div>
        )}
        {saved && !dirty && <div className="text-xs text-profit">Kaydedildi.</div>}

        <Panel title="Profil">
          <Row label="Sunucu">
            <NativeSelect label="Sunucu" value={draft.server} onChange={(v) => set({ server: v as ServerId })}>
              {SERVER_IDS.map((s) => (
                <option key={s} value={s}>
                  {SERVERS[s].label}
                </option>
              ))}
            </NativeSelect>
          </Row>
          <Row label="Ana şehir" hint="Panel ve tablolarda varsayılan alış şehri.">
            <NativeSelect label="Ana şehir" value={draft.homeCity} onChange={(v) => set({ homeCity: v as City })}>
              {ROYAL_CITIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </Row>
          <Row label="Premium" hint="Sales Tax oranını belirler.">
            <Switch checked={draft.premium} onCheckedChange={(v) => set({ premium: v })} />
            <span className="text-xs text-muted-foreground">{draft.premium ? "Premium aktif" : "Premium yok"}</span>
          </Row>
        </Panel>

        <Panel title="Sermaye">
          <Row label="Toplam silver">
            <NumInput value={draft.totalSilver} onChange={(v) => set({ totalSilver: Math.round(v ?? 0) })} />
            <span className="num text-xs text-muted-foreground">{formatCompact(draft.totalSilver)}</span>
          </Row>
          <Row label="Ticaret bütçesi" hint="Optimizer yalnızca bu tutarı kullanır.">
            <NumInput value={draft.tradeBudget} onChange={(v) => set({ tradeBudget: Math.round(v ?? 0) })} />
            <span className="num text-xs text-muted-foreground">
              {formatCompact(draft.tradeBudget)} · dokunulmayan {formatCompact(Math.max(0, draft.totalSilver - draft.tradeBudget))}
            </span>
          </Row>
          <Row label="Risk tercihi" hint="Pozisyon büyüklüğü ve hacim payı varsayımlarını belirler.">
            {RISK_PREFERENCES.map((r: RiskPreference) => (
              <button
                key={r}
                type="button"
                aria-pressed={draft.riskPreference === r}
                onClick={() => set({ riskPreference: r })}
                className={cn(
                  "h-7 rounded-md border px-2.5 text-xs",
                  draft.riskPreference === r ? "border-primary/60 bg-primary/15 text-primary" : "border-input text-muted-foreground hover:text-foreground",
                )}
              >
                {RISK_PREFERENCE_LABELS[r]}
              </button>
            ))}
          </Row>
        </Panel>

        <Panel title="Fırsat eşikleri">
          <Row label="Minimum ROI">
            <NumInput value={draft.minRoi} scale={100} suffix="%" width="w-28" onChange={(v) => set({ minRoi: v ?? 0 })} />
          </Row>
          <Row label="Veri güncelliği sınırı" hint="Bundan eski fiyatlar güncel fırsat sayılmaz.">
            <NumInput value={draft.maxDataAgeMinutes} suffix="dk" width="w-28" onChange={(v) => set({ maxDataAgeMinutes: Math.round(v ?? 0) })} />
          </Row>
        </Panel>

        <Panel title="Sales Tax ve Setup Fee varsayımları">
          <p className="border-b border-border/60 px-3 py-2 text-[11px] leading-relaxed text-warn">{FEE_ASSUMPTION_NOTE}</p>
          <Row label="Setup Fee" hint={`Varsayılan %${DEFAULT_FEES.setupFeeRate * 100}`}>
            <NumInput value={draft.fees.setupFeeRate} scale={100} suffix="%" width="w-28" onChange={(v) => setFees({ setupFeeRate: v ?? 0 })} />
          </Row>
          <Row label="Sales Tax (Premium)" hint={`Varsayılan %${DEFAULT_FEES.salesTaxRatePremium * 100}`}>
            <NumInput value={draft.fees.salesTaxRatePremium} scale={100} suffix="%" width="w-28" onChange={(v) => setFees({ salesTaxRatePremium: v ?? 0 })} />
          </Row>
          <Row label="Sales Tax (Premium yok)" hint={`Varsayılan %${DEFAULT_FEES.salesTaxRateNonPremium * 100}`}>
            <NumInput
              value={draft.fees.salesTaxRateNonPremium}
              scale={100}
              suffix="%"
              width="w-28"
              onChange={(v) => setFees({ salesTaxRateNonPremium: v ?? 0 })}
            />
          </Row>
          <Row label="Beklenen yeniden listeleme" hint="Sell Order başına; her biri Setup Fee'yi yeniden öder.">
            <NumInput value={draft.fees.expectedRelists} width="w-28" onChange={(v) => setFees({ expectedRelists: v ?? 0 })} />
          </Row>
        </Panel>

        <Panel title="Taşıma (opsiyonel)">
          <Row label="Taşıma maliyeti" hint="Şehirler arası ticarette kg başına silver. API'de yok; kendi tahmininiz.">
            <NumInput value={draft.transportCostPerKg} suffix="/kg" width="w-28" onChange={(v) => set({ transportCostPerKg: v ?? 0 })} />
          </Row>
          <Row label="Taşıma kapasitesi" hint="Sefer başına kg. Boş = sınırsız.">
            <NumInput value={draft.carryCapacityKg} suffix="kg" width="w-28" allowEmpty onChange={(v) => set({ carryCapacityKg: v })} />
          </Row>
        </Panel>
      </div>
    </div>
  );
}
