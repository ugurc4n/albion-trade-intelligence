/** Browser-side calls to our own /api/damage/* route handlers. */
import { ClientApiError } from "@/lib/api-client";
import type { ControlBody } from "./api-schemas";
import type { CalibrationResult } from "./calibrate";
import type { DamageState } from "./service";
import type { SessionRecord, SessionSummary } from "./types";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (res.ok) return (await res.json()) as T;
  let body: { error?: { kind?: string; message?: string } } = {};
  try {
    body = await res.json();
  } catch {
    // non-JSON error body
  }
  throw new ClientApiError(body.error?.message ?? `Server error (HTTP ${res.status})`, body.error?.kind ?? "unknown", res.status);
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export type CalibrationResponse = CalibrationResult & { captureId: string; packets: number };

export const damageApi = {
  state: (signal?: AbortSignal) => call<DamageState>("/api/damage/state", { signal, cache: "no-store" }),
  control: (body: ControlBody) => call<unknown>("/api/damage/control", post(body)),
  calibrate: () => call<CalibrationResponse>("/api/damage/calibrate", post({})),
  sessions: (signal?: AbortSignal) => call<{ sessions: SessionSummary[] }>("/api/damage/sessions", { signal, cache: "no-store" }),
  session: (id: string, signal?: AbortSignal) =>
    call<{ session: SessionRecord }>(`/api/damage/sessions/${encodeURIComponent(id)}`, { signal, cache: "no-store" }),
  lootValues: (server: string, ids: string[], signal?: AbortSignal) =>
    call<{ server: string; values: Record<string, number | null> }>(
      `/api/damage/loot-values?server=${encodeURIComponent(server)}&ids=${encodeURIComponent(ids.join(","))}`,
      { signal },
    ),
  deleteSession: (id: string) => call<{ ok: true }>(`/api/damage/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

/** "1:02:05" / "4:07" */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

