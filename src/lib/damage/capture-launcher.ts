/**
 * Starts and stops the bundled Windows capture (AlbionCapture.exe) for the desktop app, so nobody has
 * to open a terminal. Windows only lets administrators read raw packets, so starting shows the standard
 * UAC prompt (one "Yes" click). Stopping does not kill the elevated process (a normal process may not):
 * the capture asks for instructions on every post/heartbeat and exits when told to, when the app's
 * server process disappears, or when it can no longer reach the app.
 */
import { spawn } from "node:child_process";

export type LauncherState = "idle" | "starting" | "running" | "stopping" | "denied" | "error";

export type LauncherStatus = {
  /** True only inside the Windows desktop app (the capture exe is bundled and its path is known). */
  available: boolean;
  state: LauncherState;
  message: string | null;
  since: number | null;
};

/** The capture sends a heartbeat at least every ~2 s; silence beyond this means it is gone. */
const HEARTBEAT_TIMEOUT_MS = 8_000;
/** How long to wait for the UAC answer plus the first heartbeat before reporting a problem. */
const START_TIMEOUT_MS = 60_000;

class Launcher {
  private state: LauncherState = "idle";
  private message: string | null = null;
  private since: number | null = null;
  private stopRequested = false;
  private lastHeartbeat: number | null = null;

  available(): boolean {
    return process.platform === "win32" && !!process.env.ATI_CAPTURE_EXE;
  }

  status(now: number): LauncherStatus {
    this.refresh(now);
    return { available: this.available(), state: this.state, message: this.message, since: this.since };
  }

  /** Called on every ingest request (packets or an empty heartbeat). Returns whether the capture should exit. */
  heartbeat(now: number): boolean {
    this.lastHeartbeat = now;
    if (this.stopRequested) return true;
    if (this.state !== "running") this.set("running", null, now);
    return false;
  }

  start(appBaseUrl: string, now: number) {
    if (!this.available()) throw new Error("Yakalayıcı yalnızca Windows masaüstü uygulamasında başlatılabilir.");
    if (this.state === "starting" || (this.state === "running" && !this.stopRequested)) return;
    this.stopRequested = false;
    this.set("starting", "Windows izin penceresinde “Evet”e bas.", now);

    const exe = process.env.ATI_CAPTURE_EXE!;
    const args = [appBaseUrl, "--parent", String(process.pid)];
    const quote = (v: string) => `'${v.replace(/'/g, "''")}'`;
    // Start-Process -Verb RunAs is the standard way to ask Windows for elevation (UAC prompt).
    const command = `Start-Process -FilePath ${quote(exe)} -ArgumentList ${args.map(quote).join(",")} -Verb RunAs -WindowStyle Hidden`;
    const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], {
      windowsHide: true,
    });
    let stderr = "";
    ps.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    ps.on("error", (err) => this.set("error", `Yakalayıcı başlatılamadı: ${err.message}`, Date.now()));
    ps.on("close", (code) => {
      if (code === 0) return; // launched; "running" follows with the first heartbeat
      const canceled = /cancel|iptal/i.test(stderr);
      this.set(
        canceled ? "denied" : "error",
        canceled ? "İzin verilmedi. Başlat'a tekrar basıp Windows penceresinde “Evet” de." : `Yakalayıcı başlatılamadı. ${stderr.trim().slice(0, 300)}`,
        Date.now(),
      );
    });
  }

  stop(now: number) {
    this.stopRequested = true;
    if (this.state === "running" || this.state === "starting") this.set("stopping", null, now);
  }

  private refresh(now: number) {
    const silent = this.lastHeartbeat === null || now - this.lastHeartbeat > HEARTBEAT_TIMEOUT_MS;
    if (this.state === "stopping" && silent) this.set("idle", null, now);
    else if (this.state === "running" && silent) this.set("idle", "Yakalayıcı durdu (oyun bilgisayarı uyku moduna geçmiş ya da kapatılmış olabilir).", now);
    else if (this.state === "starting" && this.since !== null && now - this.since > START_TIMEOUT_MS && silent) {
      this.set("error", "Yakalayıcı başladı ama uygulamaya bağlanamadı. Güvenlik yazılımı engelliyor olabilir.", now);
    }
  }

  private set(state: LauncherState, message: string | null, now: number) {
    this.state = state;
    this.message = message;
    this.since = now;
  }
}

const g = globalThis as unknown as { __captureLauncher?: Launcher };

export function launcher(): Launcher {
  g.__captureLauncher ??= new Launcher();
  return g.__captureLauncher;
}
