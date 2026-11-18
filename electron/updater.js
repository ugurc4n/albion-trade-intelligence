/**
 * Automatic updates (electron-updater, NSIS installer, GitHub Releases feed set under `publish` in
 * electron-builder.yml).
 *
 * The installed app checks shortly after start and then every few hours, downloads a newer version in the
 * background and installs it the next time the app closes — or right away when the user clicks "Restart to
 * update" in the sidebar. Before the installer runs, the app server is stopped and the packet capture
 * (AlbionCapture.exe, elevated, so it cannot be killed from here) is given time to notice and exit, because a
 * running capture would keep its file locked and break the install.
 *
 * Only active in the packaged app; `npm run desktop` reports updates as unsupported. Log: <userData>/updater.log.
 */
const { app, ipcMain, shell } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const FIRST_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const CAPTURE_EXIT_TIMEOUT_MS = 10_000;
// electron-builder.yml `publish`; only used to link to the release page.
const RELEASES_URL = "https://github.com/ugurc4n/albi-update/releases";

/**
 * What the sidebar shows. `phase`:
 *   unsupported  - development run, no updates
 *   idle         - nothing checked yet
 *   checking     - asking the feed
 *   latest       - this is the newest version
 *   downloading  - a newer version is coming down (`version`, `percent`)
 *   ready        - downloaded, installs on close or on "Restart to update" (`version`)
 *   installing   - closing to install
 *   error        - the last check or download failed (`message`); the next scheduled check tries again
 */
let state = { phase: "idle", current: app.getVersion() };
let autoUpdater = null;
let getWindow = () => null;
let prepareForInstall = async () => {};
/** none → preparing (stopping the server, waiting for the capture) → launched (installer started, app quits). */
let installStep = "none";

function logger() {
  const file = path.join(app.getPath("userData"), "updater.log");
  const write = (level) => (...parts) => {
    const line = `[${new Date().toISOString()}] ${level} ${parts.map((p) => (p instanceof Error ? p.stack : String(p))).join(" ")}\n`;
    try {
      // Synchronous: the last lines are written right before the app quits for the installer.
      fs.appendFileSync(file, line);
    } catch {
      // logging must never break updating
    }
  };
  return { info: write("INFO"), warn: write("WARN"), error: write("ERROR"), debug: () => {} };
}

function setState(next) {
  state = { current: app.getVersion(), ...next };
  const win = getWindow();
  if (win && !win.isDestroyed()) win.webContents.send("updates:state", state);
}

function releaseUrl(version) {
  return `${RELEASES_URL}/tag/v${version}`;
}

function check() {
  if (!autoUpdater || state.phase === "downloading" || state.phase === "ready" || state.phase === "installing") return;
  autoUpdater.checkForUpdates().catch(() => {
    // reported through the "error" event
  });
}

/** True while AlbionCapture.exe (from any folder) is running. */
function captureRunning() {
  return new Promise((resolve) => {
    execFile(
      "tasklist",
      ["/FI", "IMAGENAME eq AlbionCapture.exe", "/FO", "CSV", "/NH"],
      { windowsHide: true },
      (err, stdout) => resolve(!err && /AlbionCapture\.exe/i.test(stdout)),
    );
  });
}

async function waitForCaptureExit() {
  const deadline = Date.now() + CAPTURE_EXIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!(await captureRunning())) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  autoUpdater?.logger?.warn("AlbionCapture.exe is still running; installing anyway");
}

/**
 * Stops the server, waits for the capture to exit, then runs the installer and quits.
 * `restart`: start the new version afterwards (the user clicked "Restart to update").
 */
async function install(restart) {
  if (installStep !== "none" || state.phase !== "ready") return;
  installStep = "preparing";
  autoUpdater.logger.info(`Installing ${state.version} (${restart ? "restart requested" : "on quit"})`);
  setState({ phase: "installing", version: state.version });
  try {
    await prepareForInstall();
    await waitForCaptureExit();
  } catch (err) {
    autoUpdater.logger.error("Preparing the install failed:", err);
  }
  // From here on quitting is final: the installer is running, or the app server is gone anyway.
  installStep = "launched";
  // Silent: the one-click installer needs no input. On success quitAndInstall quits the app itself.
  autoUpdater.quitAndInstall(true, restart);
  if (!autoUpdater.quitAndInstallCalled) {
    autoUpdater.logger.error("The installer could not be started; quitting without updating");
    app.quit();
  }
}

/**
 * Call from the app's "before-quit" handler. Returns true when the updater takes over this quit (to stop the
 * server and the capture, then run the installer); the caller must then `event.preventDefault()`.
 */
function interceptQuit() {
  if (!autoUpdater) return false;
  if (installStep === "none" && state.phase === "ready") {
    void install(false);
    return true;
  }
  // Still preparing: stay alive until the installer is launched.
  return installStep === "preparing";
}

/**
 * @param {object} options
 * @param {() => Electron.BrowserWindow | null} options.window  the main window, which gets state updates
 * @param {() => Promise<void>} options.prepareForInstall       stops the app server before installing
 */
function setupUpdates(options) {
  getWindow = options.window;
  prepareForInstall = options.prepareForInstall;

  ipcMain.handle("updates:get-state", () => state);
  ipcMain.handle("updates:check", () => {
    check();
    return state;
  });
  ipcMain.on("updates:install", () => void install(true));
  ipcMain.on("updates:open-notes", () => {
    if (state.version) shell.openExternal(releaseUrl(state.version));
  });

  if (!app.isPackaged) {
    setState({ phase: "unsupported" });
    return;
  }

  ({ autoUpdater } = require("electron-updater"));
  autoUpdater.logger = logger();
  autoUpdater.autoDownload = true;
  // We install on quit ourselves (interceptQuit), after the server and the capture are gone.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.disableWebInstaller = true;

  autoUpdater.on("checking-for-update", () => setState({ phase: "checking" }));
  autoUpdater.on("update-not-available", () => setState({ phase: "latest" }));
  autoUpdater.on("update-available", (info) => setState({ phase: "downloading", version: info.version, percent: 0 }));
  autoUpdater.on("download-progress", (p) => {
    if (state.phase === "downloading") setState({ ...state, percent: Math.round(p.percent) });
  });
  autoUpdater.on("update-downloaded", (info) => setState({ phase: "ready", version: info.version }));
  autoUpdater.on("error", (err) => {
    if (state.phase === "installing") return;
    // Offline, GitHub unreachable, a broken download: the next scheduled check tries again.
    setState({ phase: "error", message: err?.message ? String(err.message).split("\n")[0] : "Update check failed." });
  });
  setTimeout(check, FIRST_CHECK_DELAY_MS);
  setInterval(check, CHECK_INTERVAL_MS).unref();
}

module.exports = { setupUpdates, interceptQuit };
