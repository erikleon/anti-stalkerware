import { el, mount } from "./dom.js";
import { renderNav, type Screen } from "./nav.js";
import { renderLockScreen } from "./screens/lock.js";
import { renderSupportScreen } from "./screens/support.js";
import { renderTriageScreen } from "./screens/triage.js";
import { renderVaultExportScreen } from "./screens/vault-export.js";
import { renderOsintScreen } from "./screens/osint.js";
import { renderSettingsScreen } from "./screens/settings.js";
import { renderDestroyScreen } from "./screens/destroy.js";
import { renderOnboardingScreen } from "./screens/onboarding.js";
import { renderBoundariesScreen } from "./screens/boundaries.js";
import { renderIncidentLogScreen } from "./screens/incident-log.js";

type AppState =
  | { kind: "loading" }
  | { kind: "lock"; mode: "create" | "unlock"; error?: string; info?: string }
  | { kind: "support-standalone" }
  | { kind: "unlocked"; screen: Screen; onboardingSource?: SourceKind };

const root = document.getElementById("app");
if (!root) throw new Error("missing #app root element");

let state: AppState = { kind: "loading" };

async function boot(info?: string): Promise<void> {
  const exists = await window.docket.vault.exists();
  state = { kind: "lock", mode: exists ? "unlock" : "create", ...(info ? { info } : {}) };
  render();
}

async function submitPassphrase(passphrase: string): Promise<void> {
  if (state.kind !== "lock") return;
  const result = state.mode === "create" ? await window.docket.vault.initialize(passphrase) : await window.docket.vault.unlock(passphrase);
  if (result.ok) {
    state = { kind: "unlocked", screen: "triage" };
    render();
  } else {
    // Wrong passphrase and a corrupted vault are indistinguishable on
    // purpose (D19) — this is the one message for both.
    state = { kind: "lock", mode: state.mode, error: "That passphrase didn't work." };
    render();
  }
}

function render(): void {
  if (state.kind === "loading") {
    mount(root!, el("div", { class: "empty-state" }, ["Loading…"]));
    return;
  }

  if (state.kind === "lock") {
    renderLockScreen(root!, {
      mode: state.mode,
      ...(state.error ? { error: state.error } : {}),
      ...(state.info ? { info: state.info } : {}),
      onSubmit: (passphrase) => void submitPassphrase(passphrase),
      onHelp: () => {
        state = { kind: "support-standalone" };
        render();
      },
    });
    return;
  }

  if (state.kind === "support-standalone") {
    renderSupportScreen(root!, {
      onBack: () => {
        void boot();
      },
    });
    return;
  }

  // Unlocked: app nav + the active screen.
  const shell = el("div", { style: "display:flex;width:100%;" });
  const osintUnlockedGuess = false; // real eligibility is fetched inside the OSINT screen itself; the nav glyph only needs to know "any eligible sender exists", refined there.
  shell.append(renderNav(state.screen, osintUnlockedGuess, navigate));
  const screenContainer = el("div", { class: "screen", style: "flex:1;" });
  shell.append(screenContainer);
  mount(root!, shell);

  switch (state.screen) {
    case "triage":
      void renderTriageScreen(screenContainer);
      break;
    case "incident-log":
      void renderIncidentLogScreen(screenContainer);
      break;
    case "vault-export":
      void renderVaultExportScreen(screenContainer);
      break;
    case "osint":
      void renderOsintScreen(screenContainer);
      break;
    case "support":
      renderSupportScreen(screenContainer);
      break;
    case "settings":
      void renderSettingsScreen(
        screenContainer,
        () => navigate("destroy"),
        (source) => {
          state = { kind: "unlocked", screen: "onboarding", onboardingSource: source };
          render();
        },
        () => navigate("boundaries"),
        () => {
          void window.docket.vault.lock().then(() => boot());
        },
      );
      break;
    case "destroy":
      void renderDestroyScreen(screenContainer, () => void boot());
      break;
    case "onboarding":
      if (state.onboardingSource) {
        void renderOnboardingScreen(screenContainer, state.onboardingSource, () => navigate("settings"));
      } else {
        navigate("settings");
      }
      break;
    case "boundaries":
      void renderBoundariesScreen(screenContainer);
      break;
  }
}

function navigate(screen: Screen): void {
  state = { kind: "unlocked", screen };
  render();
}

// Main decides an idle lockout on its own timer — nothing here is polling
// for it, so it has to be pushed. Re-running boot() is safe from any
// screen: it just re-checks vault existence and shows the lock screen.
// When a background scoring pass finds new scores, redraw Triage so its
// bands and reasons update. Only Triage: other screens can hold a
// half-typed form, and they read fresh data each time they open anyway.
window.docket.scoring.onStatus((status) => {
  if (status.state === "ready" && (status.lastRun?.scored ?? 0) > 0 && state.kind === "unlocked" && state.screen === "triage") {
    render();
  }
});

window.docket.vault.onLocked(() => {
  void boot("Locked after inactivity.");
});

void boot();
