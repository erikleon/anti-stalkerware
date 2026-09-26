import { app, BrowserWindow, globalShortcut } from "electron";
import * as path from "node:path";
import { VaultSession } from "./vault-session";
import { SettingsStore } from "./settings-store";
import { registerHandlers } from "./handlers";
import { ScoringService } from "./scoring";
import { UsernameCheckService } from "./username-check-service";
import type { Fetcher, PageFetcher } from "../osint/network/http";

// Neutral product name and icon are set at the packaging level (electron-builder
// config, not here) — nothing in this file should print or log the product's
// real name to a place an onlooker could see it.
//
// No notifications are ever created anywhere in this app. A notification is
// exactly the kind of thing that surfaces on a lock screen someone else can see.

// Ctrl+Shift+Esc is Windows' own reserved Task Manager shortcut --
// confirmed by real windows-latest CI (TODOS item 14's addendum) to
// never actually register there, not just a theoretical collision. Mac
// keeps Cmd+Shift+Esc (free there); everywhere else gets a combo that
// isn't OS-reserved. Avoiding a bare Ctrl+Alt pairing deliberately: it
// maps to AltGr on several European keyboard layouts, a second, subtler
// collision Electron's own docs warn about -- the third modifier (Shift)
// avoids that ambiguity.
const PANIC_HOTKEY = process.platform === "darwin" ? "Cmd+Shift+Escape" : "Control+Shift+Alt+H";
const PANIC_HOTKEY_LABEL = process.platform === "darwin" ? "⌘+Shift+Esc" : "Ctrl+Shift+Alt+H";
// How often to check for inactivity, not how long a session can idle —
// that's Settings' autoLockMinutes, checked fresh every tick since it can
// change at runtime. 30s keeps the worst-case lag between "idle long
// enough" and actually locking small without polling pointlessly often.
const AUTO_LOCK_CHECK_INTERVAL_MS = 30_000;

let mainWindow: BrowserWindow | null = null;
let autoLockTimer: ReturnType<typeof setInterval> | undefined;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1000,
    height: 700,
    // Floor for the 3-pane triage layout (nav strip + bucket rail + message
    // list + detail pane) — below this the panes don't fit. The OS refuses
    // to shrink the window past it rather than the app needing responsive
    // collapse logic for what's fundamentally a desktop layout.
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // The renderer is compiled separately (renderer/tsconfig.json, browser
  // ES modules — main's own tsconfig targets CommonJS for Node, which a
  // <script> tag can't run) and copied into dist/ui alongside main's own
  // output. See scripts/copy-ui-assets.mjs.
  void window.loadFile(path.join(__dirname, "../ui/index.html"));

  // The window only ever shows the app's own page. A link that slipped
  // into rich text, or a dropped file, must not replace it, and nothing
  // may open a new window.
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  return window;
}

/**
 * Locks the vault after autoLockMinutes of no IPC activity (see
 * VaultSession.touch, called on every request in handlers.ts). Pushes
 * vault:locked to the renderer afterward, since nothing there is polling
 * for this — a lock main decided on its own has to be told, not asked
 * about. autoLockMinutes of 0 disables this entirely (Settings' choice
 * each tick, not a fixed decision at startup).
 */
function registerAutoLock(session: VaultSession, settings: SettingsStore, window: BrowserWindow): void {
  autoLockTimer = setInterval(() => {
    void (async () => {
      const { autoLockMinutes } = await settings.get();
      if (autoLockMinutes <= 0) return;
      if (session.isIdle(autoLockMinutes * 60 * 1000)) {
        session.lock();
        window.webContents.send("vault:locked");
      }
    })();
  }, AUTO_LOCK_CHECK_INTERVAL_MS);
}

/**
 * Hides the window instantly on demand. This must never leave a preview
 * behind in the dock, the window switcher, or a thumbnail — that's a
 * packaging/platform concern to verify in the Playwright e2e suite, not
 * something this handler alone can guarantee.
 *
 * globalShortcut.register's own return value says whether the OS actually
 * granted the shortcut — false on Linux desktops that don't support
 * global shortcuts at all (notably some Wayland compositors) or if
 * another app already owns this key combo on any platform. Silently
 * discarding that would mean the one mechanism DESIGN.md calls "the
 * actual first line of defense" could just not work, with nothing
 * telling the person relying on it. The caller surfaces this through
 * support:hotkeyStatus so the Support screen — which already explains
 * this hotkey — can say so plainly, instead of a toast that could be
 * seen over someone's shoulder.
 */
function registerPanicHotkey(window: BrowserWindow): boolean {
  return globalShortcut.register(PANIC_HOTKEY, () => {
    window.hide();
  });
}

app.whenReady().then(() => {
  const vaultDir = path.join(app.getPath("userData"), "vault");
  const settingsPath = path.join(app.getPath("userData"), "settings.json");
  const session = new VaultSession(vaultDir);
  const settings = new SettingsStore(settingsPath);

  mainWindow = createWindow();
  const window = mainWindow;
  const hotkeyRegistered = registerPanicHotkey(window);
  // The toxicity model ships inside the app (electron-builder.cjs,
  // extraResources); in development it's models/ at the repo root, filled
  // by `npm run fetch-assets`.
  const modelsDir = app.isPackaged ? path.join(process.resourcesPath, "models") : path.join(app.getAppPath(), "models");
  const scoring = new ScoringService(modelsDir, () => session.current(), (status) => window.webContents.send("scoring:changed", status));
  // Node's fetch satisfies both shapes; the narrower types keep tests free of real network.
  const usernameChecks = new UsernameCheckService(modelsDir, () => session.current(), (progress) => window.webContents.send("osint:usernameProgress", progress), {
    page: fetch as unknown as PageFetcher,
    text: fetch as unknown as Fetcher,
  });
  registerHandlers(session, settings, window, { registered: hotkeyRegistered, label: PANIC_HOTKEY_LABEL }, scoring, usernameChecks);
  registerAutoLock(session, settings, mainWindow);

  app.on("before-quit", () => session.lock());
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (autoLockTimer) clearInterval(autoLockTimer);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
