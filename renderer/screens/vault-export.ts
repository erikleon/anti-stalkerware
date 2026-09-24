import { el, mount } from "../dom.js";

/** Two-pane: full vault contents (not scoped to needs-review) plus the honest D25 export disclosure and history. No blur toggle — by the time someone is exporting, blur has served its purpose (DESIGN.md). */
export async function renderVaultExportScreen(container: Element): Promise<void> {
  const [messages, disclosure, history] = await Promise.all([
    window.antistalker.vaultExport.listAll(),
    window.antistalker.vaultExport.disclosureText(),
    window.antistalker.vaultExport.history(),
  ]);

  let filter = "";
  let exportStatus: string | undefined;

  function draw(): void {
    const screen = el("div", { class: "screen" });

    const listPane = el("div", { class: "message-list", style: "width:480px;" });
    const searchRow = el("div", { style: "padding:12px 16px;border-bottom:1px solid var(--border);" });
    const search = el("input", { type: "text", placeholder: "Search vault messages", style: "width:100%;" }) as HTMLInputElement;
    search.value = filter;
    search.addEventListener("input", () => {
      filter = search.value;
      draw();
    });
    searchRow.append(search);
    listPane.append(searchRow);

    const filtered = messages.filter(
      (m) => filter.trim().length === 0 || m.text.toLowerCase().includes(filter.toLowerCase()) || m.sender.toLowerCase().includes(filter.toLowerCase()),
    );
    if (filtered.length === 0) {
      listPane.append(el("div", { class: "empty-state" }, ["No messages match."]));
    }
    for (const m of filtered) {
      // .message-row is a row (built for triage's checkbox | content
      // layout) — this screen has no checkbox, but still needs its own
      // content wrapped in a column so sender/time and preview stack
      // instead of sitting side by side.
      const content = el("div", { style: "display:flex;flex-direction:column;gap:4px;flex:1;min-width:0;" }, [
        el("div", { class: "message-row-top" }, [
          el("span", { class: "message-row-sender" }, [m.fromSelf ? "You" : m.sender]),
          el("span", { class: "message-row-time" }, [m.sentAt.toLocaleDateString()]),
        ]),
        el("div", { class: "message-row-preview" }, [m.text]),
      ]);
      listPane.append(el("div", { class: "message-row", style: "cursor:default;" }, [content]));
    }
    screen.append(listPane);

    const pane = el("div", { class: "content-pane" });
    pane.append(el("h1", {}, ["Vault and export"]), el("p", {}, [disclosure]));

    const exportBtn = el("button", { type: "button", class: "btn btn--primary" }, ["Export to file…"]);
    exportBtn.addEventListener("click", async () => {
      const result = await window.antistalker.vaultExport.exportToFile();
      exportStatus = result ? `Exported ${result.messageCount} messages to ${result.filePath}` : undefined;
      draw();
    });
    pane.append(exportBtn);
    if (exportStatus) pane.append(el("p", {}, [exportStatus]));

    pane.append(el("h1", { style: "margin-top:16px;" }, ["Export history"]));
    if (history.length === 0) {
      pane.append(el("p", {}, ["No exports yet."]));
    } else {
      const list = el("div", { class: "list-block" });
      for (const entry of [...history].reverse()) {
        list.append(
          el("div", { class: "list-block-row" }, [
            el("div", { class: "list-block-row-title" }, [entry.occurredAt.toLocaleString()]),
            el("div", { class: "list-block-row-sub" }, [`${entry.recordCount} record${entry.recordCount === 1 ? "" : "s"}`]),
          ]),
        );
      }
      pane.append(list);
    }

    screen.append(pane);
    mount(container, screen);
  }

  draw();
}
