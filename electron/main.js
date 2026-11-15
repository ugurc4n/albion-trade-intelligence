/**
 * Albion Trade Intelligence — desktop shell.
 *
 * Starts the bundled Next.js server (resources/server/server.js) on a free loopback port in an Electron
 * utility process, then shows it in a window. Everything the web app does (market scans, Avalon roads,
 * damage meter) runs locally; the damage meter's Start button launches resources/capture/AlbionCapture.exe.
 * User data (damage sessions, calibration) lives in the per-user app data folder, not the install folder.
 */
const { app, BrowserWindow, Menu, shell, utilityProcess, dialog } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const APP_NAME = "Albion Trade Intelligence";
const START_TIMEOUT_MS = 60_000;

let server = null;
let mainWindow = null;
let quitting = false;

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
        if (Date.now() > deadline) reject(new Error("Uygulama sunucusu zamanında başlamadı."));
        else setTimeout(attempt, 250);
      });
      req.setTimeout(2000, () => req.destroy());
    };
    attempt();
  });
}

const LOADING_HTML = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${APP_NAME}</title>
<style>html,body{height:100%;margin:0;background:#11132a;color:#e8e9ff;font-family:Segoe UI,system-ui,sans-serif}
body{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px}
.mark{width:48px;height:48px;background:#7c6cff;color:#fff;display:grid;place-items:center;font-weight:700;letter-spacing:.04em;
clip-path:polygon(9px 0,100% 0,100% calc(100% - 9px),calc(100% - 9px) 100%,0 100%,0 9px)}
p{margin:0;font-size:13px;color:#a9abd6}</style></head>
<body><div class="mark">AT</div><p>Başlatılıyor…</p></body></html>`;

async function start() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    title: APP_NAME,
    backgroundColor: "#11132a",
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => (mainWindow = null));
  await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(LOADING_HTML)}`);

  // Links to other sites (render.albiononline.com icons are images, not links) open in the normal browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  try {
    const port = await freePort();
    const entry = serverEntry();
    if (!fs.existsSync(entry)) throw new Error(`Sunucu dosyası bulunamadı: ${entry}`);
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
        dialog.showErrorBox(APP_NAME, `Uygulama sunucusu beklenmedik şekilde kapandı (kod ${code}). Ayrıntılar: ${logFile}`);
        app.quit();
      }
    });

    const url = `http://127.0.0.1:${port}`;
    await waitForServer(`${url}/api/status`, Date.now() + START_TIMEOUT_MS);
    if (mainWindow) await mainWindow.loadURL(url);
  } catch (err) {
    dialog.showErrorBox(APP_NAME, `Uygulama başlatılamadı.\n\n${err instanceof Error ? err.message : String(err)}`);
    app.quit();
  }
}

app.on("before-quit", () => {
  quitting = true;
  // The capture notices the server is gone and exits on its own (it watches the server's process id).
  if (server) server.kill();
});

app.on("window-all-closed", () => app.quit());
