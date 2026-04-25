import { app, BrowserWindow, ipcMain, globalShortcut, screen, session } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { execSync } from "node:child_process";
import { config as loadEnv } from "dotenv";
import type { IPCFromWorker, IPCToWorker } from "../core/types.js";
import { getGroqKey, setGroqKey, clearGroqKey, hasGroqKey } from "./keyStore.js";
import { debug } from "../core/log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv();

// Hidden renderers get background-throttled in Chromium — AudioWorklet
// drain rate drops and our PCM queue piles up, adding latency. These
// switches keep the worker renderer at full speed even when hidden.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

let workerWin: BrowserWindow | null = null;
let overlayWin: BrowserWindow | null = null;
let capture: ChildProcess | null = null;

/**
 * Find the default playback sink — we'll tap its monitor ports.
 * Captures every app mixed to the speakers: browsers, VoIP, native players, games.
 */
function findDefaultSink(): string {
  try {
    return execSync("pactl get-default-sink", { encoding: "utf8" }).trim();
  } catch (err) {
    throw new Error(
      `Could not read default sink via pactl: ${(err as Error).message}`,
    );
  }
}

/**
 * Ensure the sink's monitor source is at 100% volume. Some configs leave it
 * attenuated (e.g. 8%), which makes captured audio arrive at essentially
 * noise-floor levels and breaks VAD / transcription entirely.
 */
function ensureMonitorVolumeFull(sink: string): void {
  const monitor = `${sink}.monitor`;
  try {
    execSync(`pactl set-source-volume ${monitor} 100%`);
    execSync(`pactl set-source-mute ${monitor} 0`);
  } catch (err) {
    console.warn(`[ghst main] could not set monitor volume: ${(err as Error).message}`);
  }
}

function startCapture(): void {
  if (capture) return;
  if (process.platform !== "linux") {
    throw new Error(
      `System-audio capture is currently Linux-only (PipeWire). Detected platform: ${process.platform}.`,
    );
  }
  const sink = findDefaultSink();
  ensureMonitorVolumeFull(sink);
  debug(`[ghst main] tapping monitor of ${sink}`);
  // Note on arg shape:
  //   `--target=<sink>` + property `stream.capture.sink=true` tells PipeWire
  //   to attach our capture stream to the sink's MONITOR ports. Without that
  //   property, pw-record silently falls back to the default source (mic).
  capture = spawn(
    "pw-record",
    [
      "-P",
      "stream.capture.sink=true",
      `--target=${sink}`,
      "--rate=16000",
      "--channels=1",
      "--format=s16",
      "--latency=40ms",
      "-",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  capture.stdout?.on("data", (chunk: Buffer) => {
    workerWin?.webContents.send("evt:pcm", chunk);
  });
  capture.stderr?.on("data", (d) =>
    console.error("[pw-record]", d.toString().trim()),
  );
  capture.on("exit", (code) => {
    debug(`[ghst main] pw-record exited ${code}`);
    capture = null;
  });
}

function stopCapture(): void {
  if (!capture) return;
  capture.kill("SIGTERM");
  capture = null;
}

function createWorker(): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/worker.mjs"),
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/worker/index.html`);
  } else {
    win.loadFile(join(__dirname, "../renderer/worker/index.html"));
  }
  if (!app.isPackaged) win.webContents.openDevTools({ mode: "detach" });
  return win;
}

function createOverlay(): BrowserWindow {
  const { workAreaSize } = screen.getPrimaryDisplay();
  const width = 820;
  const height = 400;
  const win = new BrowserWindow({
    width,
    height,
    x: Math.round((workAreaSize.width - width) / 2),
    y: 40,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minHeight: 200,
    minWidth: 480,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: join(__dirname, "../preload/overlay.mjs"),
      sandbox: false,
    },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // setContentProtection prevents the overlay from appearing in screenshots /
  // screen recordings on macOS and Windows. It's a no-op on Linux/Wayland.
  if (process.platform === "darwin" || process.platform === "win32") {
    win.setContentProtection(true);
  }
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/overlay/index.html`);
  } else {
    win.loadFile(join(__dirname, "../renderer/overlay/index.html"));
  }
  return win;
}

function wireIPC(): void {
  ipcMain.on("cmd:to-worker", (_e, msg: IPCToWorker) => {
    workerWin?.webContents.send("cmd:to-worker", msg);
  });
  ipcMain.on("evt:from-worker", (_e, msg: IPCFromWorker) => {
    overlayWin?.webContents.send("evt:from-worker", msg);
  });
  ipcMain.on("overlay:cmd-self", (_e, cmd: { kind: string }) => {
    if (cmd?.kind === "hide") overlayWin?.hide();
  });
  ipcMain.handle("cfg:groq-key", () => getGroqKey());
  ipcMain.handle("cfg:has-groq-key", () => hasGroqKey());
  ipcMain.handle("cfg:set-groq-key", (_e, key: string) => {
    try {
      setGroqKey(key);
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }
  });
  ipcMain.handle("cfg:clear-groq-key", () => {
    clearGroqKey();
  });
  ipcMain.handle("capture:start", () => {
    startCapture();
    return { ok: true as const };
  });
  ipcMain.handle("capture:stop", () => {
    stopCapture();
  });
}

function registerShortcuts(): void {
  globalShortcut.register("CommandOrControl+Shift+L", () => {
    if (!overlayWin) return;
    if (overlayWin.isVisible()) overlayWin.hide();
    else overlayWin.show();
  });
  globalShortcut.register("CommandOrControl+Shift+Space", () => {
    overlayWin?.webContents.send("overlay:cmd", { kind: "toggle-listen" });
  });
  globalShortcut.register("CommandOrControl+Shift+C", () => {
    overlayWin?.webContents.send("overlay:cmd", { kind: "clear" });
  });
  globalShortcut.register("CommandOrControl+Shift+Return", () => {
    workerWin?.webContents.send("cmd:to-worker", { kind: "copilot:trigger" });
  });
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === "media");
  });
  session.defaultSession.setPermissionCheckHandler(() => true);

  wireIPC();
  workerWin = createWorker();
  overlayWin = createOverlay();

  registerShortcuts();

  // First-run nudge: if we have no key, ask the overlay to show its settings
  // dialog as soon as it has finished loading.
  if (!hasGroqKey()) {
    overlayWin.webContents.once("did-finish-load", () => {
      overlayWin?.webContents.send("overlay:cmd", { kind: "open-settings" });
    });
  }
});

app.on("window-all-closed", () => {
  stopCapture();
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  stopCapture();
  globalShortcut.unregisterAll();
});
