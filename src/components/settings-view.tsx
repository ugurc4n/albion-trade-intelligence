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
          const t = e.target.value.trim().replace(/,/g, "");
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
  if (!hydrated) return <PageHeader section="settings" title="Settings" description="Loading…" />;
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
  if (draft.tradeBudget > draft.totalSilver) errors.push("The trade budget cannot be larger than total silver.");
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  return (
    <div className="pb-6">
      <PageHeader section="settings"
        title="Settings"
        description="Settings are stored only in this browser (localStorage). Calculations run on the server with these values."
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={onReset}>
              <RotateCcw /> Defaults
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
              <Check /> Save
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
        {saved && !dirty && <div className="text-xs text-profit">Saved.</div>}

        <Panel title="Profile">
          <Row label="Server">
            <NativeSelect label="Server" value={draft.server} onChange={(v) => set({ server: v as ServerId })}>
              {SERVER_IDS.map((s) => (
                <option key={s} value={s}>
                  {SERVERS[s].label}
                </option>
              ))}
            </NativeSelect>
          </Row>
          <Row label="Home city" hint="Default buy city on the Dashboard and in tables.">
            <NativeSelect label="Home city" value={draft.homeCity} onChange={(v) => set({ homeCity: v as City })}>
              {ROYAL_CITIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </Row>
          <Row label="Premium" hint="Sets the Sales Tax rate.">
            <Switch checked={draft.premium} onCheckedChange={(v) => set({ premium: v })} />
            <span className="text-xs text-muted-foreground">{draft.premium ? "Premium active" : "No Premium"}</span>
          </Row>
        </Panel>

        <Panel title="Capital">
          <Row label="Total silver">
            <NumInput value={draft.totalSilver} onChange={(v) => set({ totalSilver: Math.round(v ?? 0) })} />
            <span className="num text-xs text-muted-foreground">{formatCompact(draft.totalSilver)}</span>
          </Row>
          <Row label="Trade budget" hint="The Budget Optimizer only uses this amount.">
            <NumInput value={draft.tradeBudget} onChange={(v) => set({ tradeBudget: Math.round(v ?? 0) })} />
            <span className="num text-xs text-muted-foreground">
              {formatCompact(draft.tradeBudget)} · untouched {formatCompact(Math.max(0, draft.totalSilver - draft.tradeBudget))}
            </span>
          </Row>
          <Row label="Risk preference" hint="Sets the position size and volume share assumptions.">
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

        <Panel title="Opportunity thresholds">
          <Row label="Minimum ROI">
            <NumInput value={draft.minRoi} scale={100} suffix="%" width="w-28" onChange={(v) => set({ minRoi: v ?? 0 })} />
          </Row>
          <Row label="Data age limit" hint="Prices older than this are not counted as current opportunities.">
            <NumInput value={draft.maxDataAgeMinutes} suffix="min" width="w-28" onChange={(v) => set({ maxDataAgeMinutes: Math.round(v ?? 0) })} />
          </Row>
        </Panel>

        <Panel title="Sales Tax and Setup Fee assumptions">
          <p className="border-b border-border/60 px-3 py-2 text-[11px] leading-relaxed text-warn">{FEE_ASSUMPTION_NOTE}</p>
          <Row label="Setup Fee" hint={`Default ${DEFAULT_FEES.setupFeeRate * 100}%`}>
            <NumInput value={draft.fees.setupFeeRate} scale={100} suffix="%" width="w-28" onChange={(v) => setFees({ setupFeeRate: v ?? 0 })} />
          </Row>
          <Row label="Sales Tax (Premium)" hint={`Default ${DEFAULT_FEES.salesTaxRatePremium * 100}%`}>
            <NumInput value={draft.fees.salesTaxRatePremium} scale={100} suffix="%" width="w-28" onChange={(v) => setFees({ salesTaxRatePremium: v ?? 0 })} />
          </Row>
          <Row label="Sales Tax (no Premium)" hint={`Default ${DEFAULT_FEES.salesTaxRateNonPremium * 100}%`}>
            <NumInput
              value={draft.fees.salesTaxRateNonPremium}
              scale={100}
              suffix="%"
              width="w-28"
              onChange={(v) => setFees({ salesTaxRateNonPremium: v ?? 0 })}
            />
          </Row>
          <Row label="Expected relists" hint="Per Sell Order; each one pays the Setup Fee again.">
            <NumInput value={draft.fees.expectedRelists} width="w-28" onChange={(v) => setFees({ expectedRelists: v ?? 0 })} />
          </Row>
        </Panel>

        <Panel title="Transport (optional)">
          <Row label="Transport cost" hint="Silver per kg for cross-city trades. Not in the API; your own estimate.">
            <NumInput value={draft.transportCostPerKg} suffix="/kg" width="w-28" onChange={(v) => set({ transportCostPerKg: v ?? 0 })} />
          </Row>
          <Row label="Carry capacity" hint="kg per trip. Empty = unlimited.">
            <NumInput value={draft.carryCapacityKg} suffix="kg" width="w-28" allowEmpty onChange={(v) => set({ carryCapacityKg: v })} />
          </Row>
        </Panel>
      </div>
    </div>
  );
}
