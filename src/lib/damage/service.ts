import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { AutoCalibrator, type AutoCalibrationStatus } from "./auto-calibrator";
import { launcher, type LauncherStatus } from "./capture-launcher";
import { analyzeCalibration, type CalibrationResult } from "./calibrate";
import { DamageMeter } from "./meter";
import { PhotonDecoder, type DecodeStats, type PhotonMessage } from "./photon";
import {
  DEFAULT_DAMAGE_SETTINGS,
  damageConfigSchema,
  damageSettingsSchema,
  summarizeSession,
  type DamageConfig,
  type DamageSettings,
  type SessionRecord,
  type SessionSummary,
} from "./types";

/** The desktop app points ATI_DATA_DIR at the user's AppData folder; in development data stays in ./.data. */
const DATA_DIR = process.env.ATI_DATA_DIR
  ? path.join(process.env.ATI_DATA_DIR, "damage")
  : path.join(process.cwd(), ".data", "damage");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
const CAPTURES_DIR = path.join(DATA_DIR, "captures");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

/** Calibration recordings are short; cap them so a forgotten recording cannot eat memory. */
const MAX_RECORDING_PACKETS = 60_000;
const MAX_RECORDING_MS = 10 * 60_000;
const CONNECTED_WINDOW_MS = 5_000;
/** Bump when the shape of the service changes, so dev hot-reloads do not keep a stale singleton. */
const SERVICE_VERSION = 7;
/** The running session is written to disk this often, so closing the app does not lose it. */
const PERSIST_INTERVAL_MS = 30_000;

export type RawPacket = { t: number; d: string };

type Recording = { id: string; startedAt: number; packets: RawPacket[]; truncated: boolean };

type DamageService = {
  version: number;
  decoder: PhotonDecoder;
  meter: DamageMeter;
  calibrator: AutoCalibrator;
  settings: DamageSettings;
  ready: Promise<void>;
  /** Local (this machine) time of the last ingest and the capture-PC timestamp of its last packet. */
  lastPacketAt: number | null;
  lastStreamAt: number | null;
  packetsReceived: number;
  /** Per-second packet counts for the last few seconds. */
  rate: Map<number, number>;
  recording: Recording | null;
  lastCapture: { id: string; packets: RawPacket[] } | null;
  lastAutoSave: { id: string; label: string; at: number } | null;
  /** Local time the running session was last written to disk. */
  lastPersistAt: number;
};

const g = globalThis as unknown as { __damageService?: DamageService };

function newId(now: number): string {
  return `${new Date(now).toISOString().replace(/[:.]/g, "-")}_${randomUUID().slice(0, 6)}`;
}

function meterOptions(s: DamageSettings) {
  return { autoSession: s.autoSession, idleMs: s.idleMinutes * 60_000 };
}

function service(): DamageService {
  if (g.__damageService?.version !== SERVICE_VERSION) {
    const meter = new DamageMeter(null, { ...meterOptions(DEFAULT_DAMAGE_SETTINGS), newId });
    const svc: DamageService = {
      version: SERVICE_VERSION,
      decoder: new PhotonDecoder(),
      meter,
      calibrator: new AutoCalibrator(),
      settings: DEFAULT_DAMAGE_SETTINGS,
      ready: Promise.resolve(),
      lastPacketAt: null,
      lastStreamAt: null,
      packetsReceived: 0,
      rate: new Map(),
      recording: null,
      lastCapture: null,
      lastAutoSave: null,
      lastPersistAt: 0,
    };
    svc.ready = Promise.all([readJson(CONFIG_FILE), readJson(SETTINGS_FILE)]).then(([config, settings]) => {
      const c = damageConfigSchema.safeParse(config);
      if (c.success) meter.setConfig(c.data);
      const s = damageSettingsSchema.safeParse(settings ?? {});
      svc.settings = s.success ? s.data : DEFAULT_DAMAGE_SETTINGS;
      meter.setOptions(meterOptions(svc.settings));
    });
    g.__damageService = svc;
  }
  return g.__damageService!;
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/** Best estimate of "now" on the capture PC's clock (session times come from that clock). */
function streamNow(svc: DamageService, localNow: number): number {
  if (svc.lastStreamAt === null || svc.lastPacketAt === null) return localNow;
  return svc.lastStreamAt + (localNow - svc.lastPacketAt);
}

async function writeConfig(config: DamageConfig | null) {
  await mkdir(DATA_DIR, { recursive: true });
  if (config) await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
  else await rm(CONFIG_FILE, { force: true });
}

async function saveSessionFile(session: SessionRecord) {
  await mkdir(SESSIONS_DIR, { recursive: true });
  await writeFile(path.join(SESSIONS_DIR, `${session.id}.json`), JSON.stringify(session));
}

/** Applies a new config and replays the buffered traffic so nothing seen before calibration is lost. */
async function applyConfig(svc: DamageService, config: DamageConfig, replay: "full" | "identities") {
  svc.meter.setConfig(config);
  for (const m of svc.calibrator.messages()) {
    if (replay === "full") svc.meter.handle(m);
    else svc.meter.learnIdentities(m);
  }
  await writeConfig(config);
}

/** Last moment anything happened in a session: what an interrupted session (app closed) is taken to end at. */
function lastActivity(s: SessionRecord): number {
  return Math.max(s.startedAt, s.fame?.lastAt ?? 0, s.silver?.lastAt ?? 0, ...s.players.map((p) => p.lastAt ?? 0));
}

/** Writes the running session as if it ended at its last activity; the final save overwrites it. */
async function persistRunning(svc: DamageService, localNow: number) {
  if (localNow - svc.lastPersistAt < PERSIST_INTERVAL_MS) return;
  const running = svc.meter.snapshot();
  if (!running) return;
  svc.lastPersistAt = localNow;
  await saveSessionFile({ ...running, endedAt: lastActivity(running) });
}

async function closeIdleSession(svc: DamageService, now: number) {
  const runningId = svc.meter.snapshot()?.id;
  const { saved, discarded } = svc.meter.tick(now);
  // A session too small to keep may already have been written while it was running.
  if (discarded && runningId) await rm(path.join(SESSIONS_DIR, `${runningId}.json`), { force: true });
  if (saved) {
    await saveSessionFile(saved);
    svc.lastAutoSave = { id: saved.id, label: saved.label, at: Date.now() };
  }
}

export async function ingestPackets(packets: RawPacket[]): Promise<{ accepted: number; messages: number; stop: boolean }> {
  const svc = service();
  await svc.ready;
  const localNow = Date.now();
  const decoded: PhotonMessage[] = [];
  for (const p of packets) {
    const payload = Buffer.from(p.d, "base64");
    if (payload.byteLength === 0) continue;
    for (const m of svc.decoder.decodePacket(new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength), p.t)) {
      decoded.push(m);
      svc.meter.handle(m);
    }
    const rec = svc.recording;
    if (rec) {
      if (rec.packets.length < MAX_RECORDING_PACKETS && localNow - rec.startedAt < MAX_RECORDING_MS) rec.packets.push(p);
      else rec.truncated = true;
    }
    svc.lastStreamAt = Math.max(svc.lastStreamAt ?? 0, p.t);
  }
  svc.calibrator.push(decoded);
  svc.packetsReceived += packets.length;
  svc.lastPacketAt = localNow;
  const sec = Math.floor(localNow / 1000);
  svc.rate.set(sec, (svc.rate.get(sec) ?? 0) + packets.length);
  for (const k of svc.rate.keys()) if (k < sec - 10) svc.rate.delete(k);

  const current = svc.meter.getConfig();
  // A manual calibration is the user's decision: the background check may add identity rules to it,
  // but only replaces it when it has stopped matching hits altogether.
  if (svc.settings.autoCalibrate && svc.calibrator.due(localNow, current !== null)) {
    const decision = svc.calibrator.evaluate(current, localNow, svc.meter.knownIdentities());
    if (decision) await applyConfig(svc, decision.config, decision.reason === "identity-changed" ? "identities" : "full");
  }
  await closeIdleSession(svc, streamNow(svc, localNow));
  await persistRunning(svc, localNow);
  // An empty batch is the capture's heartbeat; the reply tells it whether to keep running.
  return { accepted: packets.length, messages: decoded.length, stop: launcher().heartbeat(localNow) };
}

export type DamageState = {
  /** Current time on the capture PC's clock (falls back to this machine's clock). */
  now: number;
  capture: {
    connected: boolean;
    lastPacketAt: number | null;
    packetsReceived: number;
    packetsPerSecond: number;
    decode: DecodeStats;
    identitiesKnown: number;
    selfName: string | null;
  };
  config: DamageConfig | null;
  settings: DamageSettings;
  auto: AutoCalibrationStatus;
  lastAutoSave: { id: string; label: string; at: number } | null;
  session: SessionRecord | null;
  recording: { id: string; startedAt: number; packets: number; truncated: boolean } | null;
  lastCaptureId: string | null;
  /** Addresses the Windows capture program can POST to (this machine's LAN IPs). */
  ingestUrls: string[];
  /** Start/stop control for the bundled capture (desktop app on Windows only). */
  launcher: LauncherStatus;
};

export async function getDamageState(port: string | null): Promise<DamageState> {
  const svc = service();
  await svc.ready;
  const localNow = Date.now();
  const now = streamNow(svc, localNow);
  // The capture may have stopped (game closed): idle sessions must still be closed.
  await closeIdleSession(svc, now);
  const sec = Math.floor(localNow / 1000);
  let recent = 0;
  for (let s = sec - 5; s < sec; s++) recent += svc.rate.get(s) ?? 0;
  return {
    now,
    capture: {
      connected: svc.lastPacketAt !== null && localNow - svc.lastPacketAt < CONNECTED_WINDOW_MS,
      lastPacketAt: svc.lastPacketAt,
      packetsReceived: svc.packetsReceived,
      packetsPerSecond: Math.round(recent / 5),
      decode: { ...svc.decoder.stats },
      identitiesKnown: svc.meter.identityCount,
      selfName: svc.meter.selfName,
    },
    config: svc.meter.getConfig(),
    settings: svc.settings,
    auto: svc.calibrator.status,
    lastAutoSave: svc.lastAutoSave,
    session: svc.meter.snapshot(),
    recording: svc.recording
      ? { id: svc.recording.id, startedAt: svc.recording.startedAt, packets: svc.recording.packets.length, truncated: svc.recording.truncated }
      : null,
    lastCaptureId: svc.lastCapture?.id ?? null,
    ingestUrls: lanAddresses().map((ip) => `http://${ip}${port ? `:${port}` : ""}`),
    launcher: launcher().status(localNow),
  };
}

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) out.push(a.address);
  }
  return out;
}

export class DamageStateError extends Error {}

export async function startSession(label: string): Promise<SessionRecord> {
  const svc = service();
  await svc.ready;
  if (!svc.meter.getConfig() && !svc.meter.selfName) throw new DamageStateError("Waiting for damage calibration or for your character to be recognised; change zones while the capture is running.");
  if (svc.meter.snapshot()) throw new DamageStateError("A session is already running.");
  const now = streamNow(svc, Date.now());
  return svc.meter.startSession(newId(now), label.trim() || `Session ${new Date(now).toLocaleString("en-GB")}`, now);
}

export async function stopSession(): Promise<SessionRecord> {
  const svc = service();
  const done = svc.meter.stopSession(streamNow(svc, Date.now()));
  if (!done) throw new DamageStateError("No session is running.");
  await saveSessionFile(done);
  return done;
}

export async function saveSettings(settings: DamageSettings): Promise<void> {
  const svc = service();
  await svc.ready;
  svc.settings = settings;
  svc.meter.setOptions(meterOptions(settings));
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

export async function listSessions(): Promise<SessionSummary[]> {
  let files: string[] = [];
  try {
    files = (await readdir(SESSIONS_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: SessionSummary[] = [];
  for (const f of files) {
    try {
      out.push(summarizeSession(JSON.parse(await readFile(path.join(SESSIONS_DIR, f), "utf8")) as SessionRecord));
    } catch {
      // skip unreadable files
    }
  }
  // The running session is shown live, not in the history (it is on disk only as a safeguard).
  const running = g.__damageService?.meter.snapshot()?.id;
  return out.filter((s) => s.id !== running).sort((a, b) => b.startedAt - a.startedAt);
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

export async function getSession(id: string): Promise<SessionRecord | null> {
  if (!SAFE_ID.test(id)) return null;
  try {
    return JSON.parse(await readFile(path.join(SESSIONS_DIR, `${id}.json`), "utf8")) as SessionRecord;
  } catch {
    return null;
  }
}

export async function deleteSession(id: string): Promise<boolean> {
  if (!SAFE_ID.test(id)) return false;
  try {
    await rm(path.join(SESSIONS_DIR, `${id}.json`));
    return true;
  } catch {
    return false;
  }
}

export function startRecording(): { id: string } {
  const svc = service();
  if (svc.recording) throw new DamageStateError("A recording is already running.");
  const now = Date.now();
  svc.recording = { id: newId(now), startedAt: now, packets: [], truncated: false };
  return { id: svc.recording.id };
}

export async function stopRecording(): Promise<{ id: string; packets: number }> {
  const svc = service();
  const rec = svc.recording;
  if (!rec) throw new DamageStateError("No recording is running.");
  svc.recording = null;
  svc.lastCapture = { id: rec.id, packets: rec.packets };
  await mkdir(CAPTURES_DIR, { recursive: true });
  await writeFile(path.join(CAPTURES_DIR, `${rec.id}.jsonl`), rec.packets.map((p) => JSON.stringify(p)).join("\n"));
  return { id: rec.id, packets: rec.packets.length };
}

/** Manual calibration on the last recording; with no names, character names are detected automatically. */
export async function calibrate(names: string[]): Promise<CalibrationResult & { captureId: string; packets: number }> {
  const svc = service();
  const capture = svc.lastCapture;
  if (!capture) throw new DamageStateError("Record a capture first to analyse it.");
  const decoder = new PhotonDecoder();
  const messages = capture.packets.flatMap((p) => {
    const b = Buffer.from(p.d, "base64");
    return decoder.decodePacket(new Uint8Array(b.buffer, b.byteOffset, b.byteLength), p.t);
  });
  const result = analyzeCalibration(messages, names.length > 0 ? names : null, Date.now());
  return { ...result, captureId: capture.id, packets: capture.packets.length };
}

export async function saveConfig(config: DamageConfig | null): Promise<void> {
  const svc = service();
  await svc.ready;
  if (config) await applyConfig(svc, { ...config, source: "manual" }, "identities");
  else {
    svc.meter.setConfig(null);
    await writeConfig(null);
  }
}

/** Desktop app: start the bundled capture (shows the Windows UAC prompt). `appBaseUrl` is this server's own address. */
export function startCapture(appBaseUrl: string) {
  if (!launcher().available()) {
    throw new DamageStateError("The Start button only works in the Windows desktop app. Run the capture manually here.");
  }
  launcher().start(appBaseUrl, Date.now());
}

export function stopCapture() {
  launcher().stop(Date.now());
}
