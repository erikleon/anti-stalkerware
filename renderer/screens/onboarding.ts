import { el, ipcErrorMessage, mount } from "../dom.js";

type WizardStep = "connect" | "before-you-continue" | "select" | "importing" | "done";

const SOURCE_LABEL: Record<SourceKind, string> = {
  imessage: "iMessage",
  "android-sms": "Android SMS export",
  imap: "Email (IMAP)",
};

/**
 * Connect a source, then choose who to actually import — DESIGN.md's D7
 * "before you continue" screen, generalized from thread selection to
 * cover all three sources. Nothing is added to the vault until the user
 * confirms a selection on the "select" step; the scan itself never writes
 * to the vault (see the metadata-sweep modules this calls through IPC).
 */
export async function renderOnboardingScreen(container: Element, source: SourceKind, onFinish: () => void): Promise<void> {
  let step: WizardStep = "connect";
  let error: string | undefined;
  let sweepResults: MetadataSweepResult[] = [];
  const selected = new Set<string>();
  let syncResult: SyncResult | undefined;

  // Form fields, only the ones relevant to `source` are ever read.
  let dbPath = source === "imessage" ? "~/Library/Messages/chat.db" : "";
  let exportFilePath = "";
  let imapHost = "";
  let imapPort = 993;
  let imapSecure = true;
  let imapUser = "";
  let imapAppPassword = "";
  let imapMailbox = "INBOX";

  async function scan(): Promise<void> {
    error = undefined;
    try {
      if (source === "imessage") {
        sweepResults = await window.antistalker.onboarding.sweepImessage(dbPath);
      } else if (source === "android-sms") {
        sweepResults = await window.antistalker.onboarding.sweepAndroidSms(exportFilePath);
      } else {
        sweepResults = await window.antistalker.onboarding.sweepImap({
          host: imapHost,
          port: imapPort,
          secure: imapSecure,
          user: imapUser,
          appPassword: imapAppPassword,
          mailbox: imapMailbox,
        });
      }
      sweepResults.sort((a, b) => b.messageCount - a.messageCount);
      step = "before-you-continue";
    } catch (err) {
      error = ipcErrorMessage(err);
    }
    draw();
  }

  async function confirmImport(): Promise<void> {
    step = "importing";
    draw();
    const ids = [...selected];
    try {
      if (source === "imessage") {
        syncResult = await window.antistalker.onboarding.connectImessage(dbPath, ids);
      } else if (source === "android-sms") {
        syncResult = await window.antistalker.onboarding.connectAndroidSms(exportFilePath, ids);
      } else {
        syncResult = await window.antistalker.onboarding.connectImap(
          { host: imapHost, port: imapPort, secure: imapSecure, user: imapUser, appPassword: imapAppPassword, mailbox: imapMailbox },
          ids,
        );
      }
      step = "done";
    } catch (err) {
      error = ipcErrorMessage(err);
      step = "select";
    }
    draw();
  }

  function drawConnectForm(pane: HTMLElement): void {
    pane.append(
      el("h1", {}, [`Connect ${SOURCE_LABEL[source]}`]),
      el("p", {}, [connectHelpText(source)]),
    );

    const form = el("div", { style: "display:flex;flex-direction:column;gap:16px;" });

    if (source === "imessage") {
      form.append(pathField("chat.db location", dbPath, (v) => (dbPath = v)));
    } else if (source === "android-sms") {
      form.append(pathField("Export file (XML)", exportFilePath, (v) => (exportFilePath = v)));
    } else {
      form.append(
        textField("Server", imapHost, (v) => (imapHost = v), "imap.example.com"),
        textField("Port", String(imapPort), (v) => (imapPort = Number(v) || 993), "993"),
        (() => {
          const row = el("label", { style: "display:flex;align-items:center;gap:8px;font-size:13px;" });
          const cb = el("input", { type: "checkbox" }) as HTMLInputElement;
          cb.checked = imapSecure;
          cb.style.minWidth = "24px";
          cb.style.minHeight = "24px";
          cb.addEventListener("change", () => (imapSecure = cb.checked));
          row.append(cb, el("span", {}, ["Use a secure connection (TLS)"]));
          return row;
        })(),
        textField("Email address", imapUser, (v) => (imapUser = v), "you@example.com"),
        (() => {
          const field = el("div", { class: "field" });
          field.append(
            el("label", {}, ["App-specific password"]),
            (() => {
              const input = el("input", { type: "password", autocomplete: "off" }) as HTMLInputElement;
              input.value = imapAppPassword;
              input.addEventListener("input", () => (imapAppPassword = input.value));
              return input;
            })(),
            el("p", { style: "font-size:11px;margin:0;" }, [
              "Not your regular email password. Create one from your provider's account security settings.",
            ]),
          );
          return field;
        })(),
        textField("Mailbox", imapMailbox, (v) => (imapMailbox = v), "INBOX"),
      );
    }
    pane.append(form);

    if (error) pane.append(el("p", { style: "color:var(--high-fg);" }, [error]));

    const scanBtn = el("button", { type: "button", class: "btn btn--primary" }, ["Scan"]);
    scanBtn.addEventListener("click", () => void scan());
    pane.append(scanBtn);
  }

  function pathField(label: string, value: string, onChange: (v: string) => void): HTMLElement {
    const field = el("div", { class: "field" });
    const row = el("div", { style: "display:flex;gap:8px;" });
    const input = el("input", { type: "text" }) as HTMLInputElement;
    input.value = value;
    input.style.flex = "1";
    input.addEventListener("input", () => onChange(input.value));
    const browse = el("button", { type: "button", class: "btn" }, ["Choose file…"]);
    browse.addEventListener("click", async () => {
      const picked = await window.antistalker.onboarding.pickFile();
      if (picked) {
        input.value = picked;
        onChange(picked);
      }
    });
    row.append(input, browse);
    field.append(el("label", {}, [label]), row);
    return field;
  }

  function textField(label: string, value: string, onChange: (v: string) => void, placeholder = ""): HTMLElement {
    const field = el("div", { class: "field" });
    const input = el("input", { type: "text", placeholder }) as HTMLInputElement;
    input.value = value;
    input.addEventListener("input", () => onChange(input.value));
    field.append(el("label", {}, [label]), input);
    return field;
  }

  function drawBeforeYouContinue(pane: HTMLElement): void {
    pane.append(
      el("h1", {}, ["Before you continue"]),
      el("p", {}, [
        `The next screen lists everyone we found in your ${SOURCE_LABEL[source]} — ${sweepResults.length} sender${sweepResults.length === 1 ? "" : "s"}. Nothing is added to your vault yet. You'll choose exactly who to include.`,
      ]),
    );
    const ready = el("button", { type: "button", class: "btn btn--primary" }, ["I'm ready"]);
    ready.addEventListener("click", () => {
      step = "select";
      draw();
    });
    pane.append(ready);
  }

  function drawSelect(pane: HTMLElement): void {
    pane.append(el("h1", {}, ["Choose who to include"]));
    if (error) pane.append(el("p", { style: "color:var(--high-fg);" }, [error]));

    if (sweepResults.length === 0) {
      pane.append(el("div", { class: "empty-state" }, ["Nothing found to import."]));
    } else {
      const selectAllRow = el("label", { style: "display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-dim);" });
      const selectAllCb = el("input", { type: "checkbox" }) as HTMLInputElement;
      selectAllCb.style.minWidth = "24px";
      selectAllCb.style.minHeight = "24px";
      selectAllCb.addEventListener("change", () => {
        if (selectAllCb.checked) sweepResults.forEach((r) => selected.add(r.sender));
        else selected.clear();
        draw();
      });
      selectAllRow.append(selectAllCb, el("span", {}, ["Select all"]));
      pane.append(selectAllRow);

      const list = el("div", { class: "list-block" });
      for (const r of sweepResults) {
        const row = el("label", { class: "list-block-row", style: "flex-direction:row;align-items:center;gap:12px;cursor:pointer;" });
        const cb = el("input", { type: "checkbox" }) as HTMLInputElement;
        cb.checked = selected.has(r.sender);
        cb.style.minWidth = "24px";
        cb.style.minHeight = "24px";
        cb.addEventListener("change", () => {
          if (cb.checked) selected.add(r.sender);
          else selected.delete(r.sender);
          draw();
        });
        row.append(
          cb,
          el("div", {}, [
            el("div", { class: "list-block-row-title" }, [r.sender]),
            el("div", { class: "list-block-row-sub" }, [
              `${r.messageCount} message${r.messageCount === 1 ? "" : "s"} · ${r.firstSeenAt.toLocaleDateString()} – ${r.lastSeenAt.toLocaleDateString()}`,
            ]),
          ]),
        );
        list.append(row);
      }
      pane.append(list);
    }

    const addBtn = el("button", { type: "button", class: "btn btn--primary" }, [`Add ${selected.size} selected`]) as HTMLButtonElement;
    addBtn.disabled = selected.size === 0;
    addBtn.addEventListener("click", () => void confirmImport());
    pane.append(addBtn);
  }

  function drawImporting(pane: HTMLElement): void {
    pane.append(el("div", { class: "empty-state" }, ["Importing…"]));
  }

  function drawDone(pane: HTMLElement): void {
    pane.append(
      el("h1", {}, ["Connected"]),
      el("div", { class: "empty-state" }, [
        syncResult
          ? `Imported ${syncResult.appended} message${syncResult.appended === 1 ? "" : "s"}.${syncResult.quarantined > 0 ? ` ${syncResult.quarantined} couldn't be read and were quarantined.` : ""}`
          : "Done.",
      ]),
    );
    const done = el("button", { type: "button", class: "btn btn--primary" }, ["Back to settings"]);
    done.addEventListener("click", onFinish);
    pane.append(done);
  }

  function draw(): void {
    const pane = el("div", { class: "content-pane" });
    switch (step) {
      case "connect":
        drawConnectForm(pane);
        break;
      case "before-you-continue":
        drawBeforeYouContinue(pane);
        break;
      case "select":
        drawSelect(pane);
        break;
      case "importing":
        drawImporting(pane);
        break;
      case "done":
        drawDone(pane);
        break;
    }
    mount(container, pane);
  }

  draw();
}

function connectHelpText(source: SourceKind): string {
  switch (source) {
    case "imessage":
      return "Reads your local Messages database directly. Only works on macOS, on this device.";
    case "android-sms":
      return "Import an XML export from the “SMS Backup & Restore” app — the standard way to get SMS history off an Android phone.";
    case "imap":
      return "Connects with an app-specific password, never your account's real password.";
  }
}
