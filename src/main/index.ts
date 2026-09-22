import { app, BrowserWindow, globalShortcut } from "electron";
import * as path from "node:path";

// Neutral product name and icon are set at the packaging level (electron-builder
// config, not here) — nothing in this file should print or log the product's
// real name to a place an onlooker could see it.
//
// No notifications are ever created anywhere in this app. A notification is
// exactly the kind of thing that surfaces on a lock screen someone else can see.

const PANIC_HOTKEY = "CommandOrControl+Shift+Escape";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Loads straight from src/ui for now — no asset bundling pipeline exists
  // yet. Revisit once the renderer is more than a placeholder.
  void mainWindow.loadFile(path.join(__dirname, "../../src/ui/index.html"));
}

function registerPanicHotkey(): void {
  // Hides the window instantly on demand. This must never leave a preview
  // behind in the dock, the window switcher, or a thumbnail — that's a
  // packaging/platform concern to verify in the Playwright e2e suite, not
  // something this handler alone can guarantee.
  globalShortcut.register(PANIC_HOTKEY, () => {
    mainWindow?.hide();
  });
}

app.whenReady().then(() => {
  createWindow();
  registerPanicHotkey();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
