/**
 * Albion Trade Intelligence — desktop shell.
 *
 * Starts the bundled Next.js server (resources/server/server.js) on a free loopback port in an Electron
 * utility process, then shows it in a window. Everything the web app does (market scans, Avalon roads,
 * damage meter) runs locally; the damage meter's Start button launches resources/capture/AlbionCapture.exe.
 * User data (damage sessions, calibration) lives in the per-user app data folder, not the install folder.
 * The in-game overlay is a separate always-on-top, transparent window showing /overlay; it never touches the
 * game process (no injection or hooks), it only floats above a game running in borderless windowed mode.
 */
const { app, BrowserWindow, Menu, shell, utilityProcess, dialog, globalShortcut, ipcMain, screen } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { setupUpdates, interceptQuit } = require("./updater");

const APP_NAME = "Albion Trade Intelligence";
const START_TIMEOUT_MS = 60_000;
const PRELOAD = path.join(__dirname, "preload.js");
const OVERLAY_TOGGLE_KEY = "CommandOrControl+Shift+O";
const OVERLAY_LOCK_KEY = "CommandOrControl+Shift+L";

let server = null;
let mainWindow = null;
let quitting = false;
let appUrl = null;
let overlay = null;
let overlayLocked = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(start);
}

function resourcesRoot() {
  // Packaged: <install>/resources. Development (`npm run desktop`): the project folder.
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
}

function serverEntry() {
  return app.isPackaged
    ? path.join(resourcesRoot(), "server", "server.js")
    : path.join(resourcesRoot(), ".next-electron", "standalone", "server.js");
}

function captureExe() {
  const candidates = app.isPackaged
    ? [path.join(resourcesRoot(), "capture", "AlbionCapture.exe")]
    : [path.join(resourcesRoot(), "build", "capture", "AlbionCapture.exe")];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForServer(url, deadline) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("The app server did not start in time."));
        else setTimeout(attempt, 250);
      });
      req.setTimeout(2000, () => req.destroy());
    };
    attempt();
  });
}

const loadingPage = (text) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${APP_NAME}</title>
<style>html,body{height:100%;margin:0;background:#11132a;color:#e8e9ff;font-family:Segoe UI,system-ui,sans-serif}
body{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px}
.mark{width:48px;height:48px;background:#7c6cff;color:#fff;display:grid;place-items:center;font-weight:700;letter-spacing:.04em;
clip-path:polygon(9px 0,100% 0,100% calc(100% - 9px),calc(100% - 9px) 100%,0 100%,0 9px)}
p{margin:0;font-size:13px;color:#a9abd6}</style></head>
<body><div class="mark">AT</div><p>${text}</p></body></html>`;

/** Stops the app server and resolves once it has exited (or after a few seconds, whichever comes first). */
function stopServer() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    const timer = setTimeout(resolve, 5000);
    server.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    server.kill();
  });
}

async function start() {
  Menu.setApplicationMenu(null);
  setupUpdates({
    window: () => mainWindow,
    prepareForInstall: async () => {
      quitting = true;
      overlay?.close();
      if (mainWindow && !mainWindow.isDestroyed()) {
        await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingPage("Installing the update…"))}`).catch(() => {});
      }
      // The capture watches the server's process id and exits on its own within ~2 seconds.
      await stopServer();
    },
  });
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    title: APP_NAME,
    backgroundColor: "#11132a",
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, preload: PRELOAD },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
    // The overlay belongs to the main window: closing the app closes it too.
    app.quit();
  });
  await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingPage("Starting…"))}`);

  // Links to other sites (render.albiononline.com icons are images, not links) open in the normal browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  try {
    const port = await freePort();
    const entry = serverEntry();
    if (!fs.existsSync(entry)) throw new Error(`Server file not found: ${entry}`);
    const dataDir = path.join(app.getPath("userData"), "data");
    fs.mkdirSync(dataDir, { recursive: true });
    const exe = captureExe();

    server = utilityProcess.fork(entry, [], {
      cwd: path.dirname(entry),
      serviceName: "Albion Trade Intelligence Server",
      stdio: "pipe",
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(port),
        HOSTNAME: "127.0.0.1",
        NEXT_TELEMETRY_DISABLED: "1",
        ATI_DATA_DIR: dataDir,
        ...(exe ? { ATI_CAPTURE_EXE: exe } : {}),
      },
    });
    const logFile = path.join(app.getPath("userData"), "server.log");
    const log = fs.createWriteStream(logFile, { flags: "a" });
    server.stdout?.pipe(log);
    server.stderr?.pipe(log);
    server.on("exit", (code) => {
      server = null;
      if (!quitting) {
        dialog.showErrorBox(APP_NAME, `The app server exited unexpectedly (code ${code}). Details: ${logFile}`);
        app.quit();
      }
    });

    const url = `http://127.0.0.1:${port}`;
    await waitForServer(`${url}/api/status`, Date.now() + START_TIMEOUT_MS);
    appUrl = url;
    if (mainWindow) await mainWindow.loadURL(url);
    // Global so they work while the game has focus; a key already taken by another app is simply skipped.
    globalShortcut.register(OVERLAY_TOGGLE_KEY, toggleOverlay);
    globalShortcut.register(OVERLAY_LOCK_KEY, () => setOverlayLocked(!overlayLocked));
  } catch (err) {
    dialog.showErrorBox(APP_NAME, `The app could not be started.\n\n${err instanceof Error ? err.message : String(err)}`);
    app.quit();
  }
}

app.on("before-quit", (event) => {
  // A downloaded update installs on the way out; the updater stops the server first, then quits.
  if (interceptQuit()) {
    event.preventDefault();
    return;
  }
  quitting = true;
  // The capture notices the server is gone and exits on its own (it watches the server's process id).
  if (server) server.kill();
});

app.on("will-quit", () => globalShortcut.unregisterAll());

app.on("window-all-closed", () => app.quit());

/* ---------- in-game overlay ---------- */

const overlayFile = () => path.join(app.getPath("userData"), "overlay.json");

/** Saved position and size, used only if it is still on one of the connected screens. */
function savedOverlayBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(overlayFile(), "utf8"));
    if (![b.x, b.y, b.width, b.height].every(Number.isFinite)) return null;
    const visible = screen.getAllDisplays().some(({ workArea: a }) => b.x + 40 > a.x && b.x < a.x + a.width - 40 && b.y >= a.y && b.y < a.y + a.height - 40);
    return visible ? b : null;
  } catch {
    return null;
  }
}

function notifyOverlayOpen(open) {
  mainWindow?.webContents.send("overlay:open", open);
}

function setOverlayLocked(locked) {
  if (!overlay) return;
  overlayLocked = locked;
  // Locked: clicks go through to the game underneath.
  overlay.setIgnoreMouseEvents(locked, { forward: true });
  overlay.webContents.send("overlay:locked", locked);
}

function toggleOverlay() {
  if (overlay) overlay.close();
  else openOverlay();
}

function openOverlay() {
  if (!appUrl || overlay) return;
  const area = screen.getPrimaryDisplay().workArea;
  const saved = savedOverlayBounds();
  overlay = new BrowserWindow({
    x: saved?.x ?? area.x + area.width - 340,
    y: saved?.y ?? area.y + 80,
    width: saved?.width ?? 320,
    height: saved?.height ?? 260,
    minWidth: 240,
    minHeight: 120,
    title: `${APP_NAME} overlay`,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, preload: PRELOAD },
  });
  // Above borderless-windowed games; does not steal focus from the game when it appears.
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlayLocked = false;
  overlay.once("ready-to-show", () => overlay?.showInactive());
  overlay.on("close", () => {
    try {
      fs.writeFileSync(overlayFile(), JSON.stringify(overlay.getBounds()));
    } catch {
      // not being able to remember the position is harmless
    }
  });
  overlay.on("closed", () => {
    overlay = null;
    overlayLocked = false;
    notifyOverlayOpen(false);
  });
  overlay.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  overlay.loadURL(`${appUrl}/overlay`);
  notifyOverlayOpen(true);
}

ipcMain.on("overlay:toggle", toggleOverlay);
ipcMain.on("overlay:close", () => overlay?.close());
ipcMain.on("overlay:lock", (_event, locked) => setOverlayLocked(Boolean(locked)));
ipcMain.handle("overlay:is-open", () => overlay !== null);
