import { el, ipcErrorMessage, mount, showToast } from "../dom.js";

export async function renderSettingsScreen(
  container: Element,
  navigateToDestroy: () => void,
  navigateToOnboarding: (source: SourceKind) => void,
  navigateToBoundaries: () => void,
  lockNow: () => void,
): Promise<void> {
  const settings = await window.docket.settings.get();
  let sources = await window.docket.settings.listSources();
  let syncingSource: SourceKind | undefined;

  async function refreshSources(): Promise<void> {
    sources = await window.docket.settings.listSources();
    draw();
  }

  async function syncNow(source: SourceKind): Promise<void> {
    syncingSource = source;
    draw();
    try {
      const result = await window.docket.onboarding.syncNow(source);
      showToast(`Imported ${result.appended} new message${result.appended === 1 ? "" : "s"}`);
    } catch (err) {
      showToast(`Sync failed: ${ipcErrorMessage(err)}`);
    }
    syncingSource = undefined;
    await refreshSources();
  }

  async function disconnect(source: SourceKind): Promise<void> {
    await window.docket.onboarding.disconnect(source);
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
      await window.docket.settings.setToastOnTriageAction(checkbox.checked);
      settings.toastOnTriageAction = checkbox.checked;
    });
    toggleRow.append(checkbox, el("span", {}, ["Show a confirmation toast after Hide / Mark reviewed"]));
    pane.append(toggleRow);

    const autoLockRow = el("div", { class: "field", style: "max-width:280px;" });
    const autoLockInput = el("input", { type: "number", min: "0", step: "1" }) as HTMLInputElement;
    autoLockInput.value = String(settings.autoLockMinutes);
    autoLockInput.addEventListener("change", async () => {
      const minutes = Math.max(0, Math.floor(Number(autoLockInput.value) || 0));
      autoLockInput.value = String(minutes);
      await window.docket.settings.setAutoLockMinutes(minutes);
      settings.autoLockMinutes = minutes;
    });
    autoLockRow.append(
      el("label", {}, ["Auto-lock after this many minutes of inactivity (0 to disable)"]),
      autoLockInput,
    );
    pane.append(autoLockRow);

    const lockNowBtn = el("button", { type: "button", class: "btn" }, ["Lock now"]);
    lockNowBtn.addEventListener("click", lockNow);
    pane.append(lockNowBtn);

    const boundariesRow = el("div", { class: "list-block", style: "margin-top:8px;" });
    const boundariesLink = el("div", { class: "list-block-row", style: "flex-direction:row;align-items:center;justify-content:space-between;cursor:pointer;" });
    boundariesLink.append(
      el("div", {}, [
        el("div", { class: "list-block-row-title" }, ["Boundaries & tagged phrases"]),
        el("div", { class: "list-block-row-sub" }, ["Helps triage catch patterns that don't read as toxic on their own"]),
      ]),
      el("span", { class: "btn" }, ["Open"]),
    );
    boundariesLink.addEventListener("click", navigateToBoundaries);
    boundariesRow.append(boundariesLink);
    pane.append(boundariesRow);

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
