import { el, mount } from "../dom.js";

export async function renderSettingsScreen(container: Element, navigateToDestroy: () => void): Promise<void> {
  const [settings, sources] = await Promise.all([window.antistalker.settings.get(), window.antistalker.settings.listSources()]);

  function draw(): void {
    const pane = el("div", { class: "content-pane" });
    pane.append(el("h1", {}, ["Settings"]));

    pane.append(el("h1", { style: "font-size:13px;margin-top:8px;" }, ["Sources"]));
    const list = el("div", { class: "list-block" });
    for (const s of sources) {
      list.append(
        el("div", { class: "list-block-row" }, [
          el("div", { class: "list-block-row-title" }, [s.label]),
          el("div", { class: "list-block-row-sub" }, [s.connected ? "Connected" : "Not connected"]),
        ]),
      );
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
