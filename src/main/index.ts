import { app, BrowserWindow, globalShortcut } from "electron";
import * as path from "node:path";
import { VaultSession } from "./vault-session";
import { SettingsStore } from "./settings-store";
import { registerHandlers } from "./handlers";

// Neutral product name and icon are set at the packaging level (electron-builder
// config, not here) — nothing in this file should print or log the product's
// real name to a place an onlooker could see it.
//
// No notifications are ever created anywhere in this app. A notification is
// exactly the kind of thing that surfaces on a lock screen someone else can see.

const PANIC_HOTKEY = "CommandOrControl+Shift+Escape";

let mainWindow: BrowserWindow | null = null;

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
  return window;
}

function registerPanicHotkey(window: BrowserWindow): void {
  // Hides the window instantly on demand. This must never leave a preview
  // behind in the dock, the window switcher, or a thumbnail — that's a
  // packaging/platform concern to verify in the Playwright e2e suite, not
  // something this handler alone can guarantee.
  globalShortcut.register(PANIC_HOTKEY, () => {
    window.hide();
  });
}

app.whenReady().then(() => {
  const vaultDir = path.join(app.getPath("userData"), "vault");
  const settingsPath = path.join(app.getPath("userData"), "settings.json");
  const session = new VaultSession(vaultDir);
  const settings = new SettingsStore(settingsPath);

  mainWindow = createWindow();
  registerHandlers(session, settings, mainWindow);
  registerPanicHotkey(mainWindow);

  app.on("before-quit", () => session.lock());
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
