import { el, mount, showToast } from "../dom.js";

export async function renderSettingsScreen(
  container: Element,
  navigateToDestroy: () => void,
  navigateToOnboarding: (source: SourceKind) => void,
): Promise<void> {
  const settings = await window.antistalker.settings.get();
  let sources = await window.antistalker.settings.listSources();
  let syncingSource: SourceKind | undefined;

  async function refreshSources(): Promise<void> {
    sources = await window.antistalker.settings.listSources();
    draw();
  }

  async function syncNow(source: SourceKind): Promise<void> {
    syncingSource = source;
    draw();
    try {
      const result = await window.antistalker.onboarding.syncNow(source);
      showToast(`Imported ${result.appended} new message${result.appended === 1 ? "" : "s"}`);
    } catch (err) {
      showToast(`Sync failed: ${(err as Error).message}`);
    }
    syncingSource = undefined;
    await refreshSources();
  }

  async function disconnect(source: SourceKind): Promise<void> {
    await window.antistalker.onboarding.disconnect(source);
    await refreshSources();
  }

  function draw(): void {
    const pane = el("div", { class: "content-pane" });
    pane.append(el("h1", {}, ["Settings"]));

    pane.append(el("h1", { style: "font-size:13px;margin-top:8px;" }, ["Sources"]));
    const list = el("div", { class: "list-block" });
    for (const s of sources) {
      const row = el("div", { class: "list-block-row", style: "flex-direction:row;align-items:center;justify-content:space-between;" });
      row.append(
        el("div", {}, [
          el("div", { class: "list-block-row-title" }, [s.label]),
          el("div", { class: "list-block-row-sub" }, [s.connected ? "Connected" : "Not connected"]),
        ]),
      );

      const actions = el("div", { style: "display:flex;gap:8px;" });
      if (s.connected) {
        const syncBtn = el("button", { type: "button", class: "btn" }, [syncingSource === s.source ? "Syncing…" : "Sync now"]) as HTMLButtonElement;
        syncBtn.disabled = syncingSource !== undefined;
        syncBtn.addEventListener("click", () => void syncNow(s.source));
        const disconnectBtn = el("button", { type: "button", class: "btn" }, ["Disconnect"]);
        disconnectBtn.addEventListener("click", () => void disconnect(s.source));
        actions.append(syncBtn, disconnectBtn);
      } else {
        const connectBtn = el("button", { type: "button", class: "btn btn--primary" }, ["Connect"]);
        connectBtn.addEventListener("click", () => navigateToOnboarding(s.source));
        actions.append(connectBtn);
      }
      row.append(actions);
      list.append(row);
    }
    pane.append(list);

    const toggleRow = el("label", { style: "display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;" });
    const checkbox = el("input", { type: "checkbox" }) as HTMLInputElement;
    checkbox.checked = settings.toastOnTriageAction;
    checkbox.style.minWidth = "24px";
    checkbox.style.minHeight = "24px";
    checkbox.addEventListener("change", async () => {
      await window.antistalker.settings.setToastOnTriageAction(checkbox.checked);
      settings.toastOnTriageAction = checkbox.checked;
    });
    toggleRow.append(checkbox, el("span", {}, ["Show a confirmation toast after Hide / Mark reviewed"]));
    pane.append(toggleRow);

    const dangerZone = el("div", { class: "danger-zone" });
    dangerZone.append(
      el("div", { style: "font-size:13px;font-weight:600;" }, ["Danger zone"]),
      el("p", { style: "color:var(--text);" }, ["Remove all local app data from this device."]),
    );
    const destroyBtn = el("button", { type: "button", class: "btn btn--danger" }, ["Remove local app data…"]);
    destroyBtn.addEventListener("click", navigateToDestroy);
    dangerZone.append(destroyBtn);
    pane.append(dangerZone);

    mount(container, pane);
  }

  draw();
}
