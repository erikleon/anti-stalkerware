import { el, ipcErrorMessage, mount } from "../dom.js";

type WizardStep = "connect" | "before-you-continue" | "select" | "importing" | "done";

const SOURCE_LABEL: Record<SourceKind, string> = {
  imessage: "iMessage",
  "android-sms": "Android SMS export",
  imap: "Email (IMAP)",
  instagram: "Instagram export",
};

/**
 * Connect a source, then choose who to actually import — DESIGN.md's D7
 * "before you continue" screen, generalized from thread selection to
 * cover every source. Nothing is added to the vault until the user
 * confirms a selection on the "select" step; the scan itself never writes
 * to the vault (see the metadata-sweep modules this calls through IPC).
 */
export async function renderOnboardingScreen(container: Element, source: SourceKind, onFinish: () => void): Promise<void> {
  let step: WizardStep = "connect";
  let error: string | undefined;
  let sweepResults: SweepRow[] = [];
  let blocklist: BlocklistSummary | undefined;
  let instagramBlocked: { count: number; skipped: number } | undefined;
  const selected = new Set<string>();
  let syncResult: SyncResult | undefined;
  // Blocked senders the user selects are also saved as known accounts,
  // unless they untick this — the baseline OSINT compares new senders to.
  let saveBlockedAsKnown = true;
  let savedKnown = { added: 0, alreadyKnown: 0 };
  let saveKnownError: string | undefined;

  // Form fields, only the ones relevant to `source` are ever read.
  let dbPath = source === "imessage" ? "~/Library/Messages/chat.db" : "";
  let exportFilePath = "";
  let instagramDir = "";
  let imapHost = "";
  let imapPort = 993;
  let imapSecure = true;
  let imapUser = "";
  let imapAppPassword = "";
  let imapMailbox = "INBOX";

  // Client-side check so Scan doesn't round-trip to the main process just
  // to get back the same "a required field is empty" answer connectImap()
  // etc. already throw defensively (found via /qa: submitting an
  // all-blank IMAP form did work, just the slow way).
  function requiredFieldsFilled(): boolean {
    if (source === "imessage") return dbPath.trim().length > 0;
    if (source === "android-sms") return exportFilePath.trim().length > 0;
    if (source === "instagram") return instagramDir.trim().length > 0;
    return imapHost.trim().length > 0 && imapUser.trim().length > 0 && imapAppPassword.trim().length > 0;
  }

  async function scan(): Promise<void> {
    error = undefined;
    try {
      let response: SweepResponse;
      if (source === "imessage") {
        response = await window.docket.onboarding.sweepImessage(dbPath);
      } else if (source === "android-sms") {
        response = await window.docket.onboarding.sweepAndroidSms(exportFilePath);
      } else if (source === "instagram") {
        response = await window.docket.onboarding.sweepInstagram(instagramDir);
      } else {
        response = await window.docket.onboarding.sweepImap({
          host: imapHost,
          port: imapPort,
          secure: imapSecure,
          user: imapUser,
          appPassword: imapAppPassword,
          mailbox: imapMailbox,
        });
      }
      blocklist = response.blocklist;
      instagramBlocked = response.instagramBlocked;
      // Blocked and already-known senders first, then by volume. They start
      // selected: their messages from before the block are what lets docket
      // recognize the same person writing from a new number later.
      sweepResults = response.rows.sort(
        (a, b) => Number(isFlagged(b)) - Number(isFlagged(a)) || b.messageCount - a.messageCount,
      );
      selected.clear();
      for (const row of sweepResults) if (isFlagged(row)) selected.add(row.sender);
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
        syncResult = await window.docket.onboarding.connectImessage(dbPath, ids);
      } else if (source === "android-sms") {
        syncResult = await window.docket.onboarding.connectAndroidSms(exportFilePath, ids);
      } else if (source === "instagram") {
        syncResult = await window.docket.onboarding.connectInstagram(instagramDir, ids);
      } else {
        syncResult = await window.docket.onboarding.connectImap(
          { host: imapHost, port: imapPort, secure: imapSecure, user: imapUser, appPassword: imapAppPassword, mailbox: imapMailbox },
          ids,
        );
      }
      step = "done";
    } catch (err) {
      error = ipcErrorMessage(err);
      step = "select";
      draw();
      return;
    }

    // The import already succeeded at this point, so a failure here is
    // reported on the done screen, not by sending the user back a step.
    if (saveBlockedAsKnown) {
      try {
        const macIds = sweepResults.filter((r) => r.blockedOn === "macos" && selected.has(r.sender)).map((r) => r.sender);
        if (macIds.length > 0) addSaved(await window.docket.onboarding.saveBlockedAsKnown(macIds));
        if (source === "instagram" && (instagramBlocked?.count ?? 0) > 0) {
          addSaved(await window.docket.onboarding.importInstagramBlocked(instagramDir));
        }
      } catch (err) {
        saveKnownError = ipcErrorMessage(err);
      }
    }
    draw();
  }

  function addSaved(result: { added: number; alreadyKnown: number }): void {
    savedKnown = { added: savedKnown.added + result.added, alreadyKnown: savedKnown.alreadyKnown + result.alreadyKnown };
  }

  function drawConnectForm(pane: HTMLElement): void {
    pane.append(
      el("h1", {}, [`Connect ${SOURCE_LABEL[source]}`]),
      el("p", {}, [connectHelpText(source)]),
    );

    // Declared before the fields below so their onChange handlers can
    // close over it — safe even though scanBtn itself isn't assigned
    // until after they're built, since those handlers only ever run
    // later, on user input, never during this synchronous render.
    let scanBtn: HTMLButtonElement;
    function revalidate(): void {
      scanBtn.disabled = !requiredFieldsFilled();
    }

    const form = el("div", { style: "display:flex;flex-direction:column;gap:16px;" });

    if (source === "instagram") {
      form.append(
        pathField(
          "Export folder (unzipped)",
          instagramDir,
          (v) => {
            instagramDir = v;
            revalidate();
          },
          "folder",
        ),
      );
    } else if (source === "imessage") {
      form.append(
        pathField("chat.db location", dbPath, (v) => {
          dbPath = v;
          revalidate();
        }),
      );
    } else if (source === "android-sms") {
      form.append(
        pathField("Export file (XML)", exportFilePath, (v) => {
          exportFilePath = v;
          revalidate();
        }),
      );
    } else {
      form.append(
        textField("Server", imapHost, (v) => {
          imapHost = v;
          revalidate();
        }, "imap.example.com"),
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
        textField("Email address", imapUser, (v) => {
          imapUser = v;
          revalidate();
        }, "you@example.com"),
        (() => {
          const field = el("div", { class: "field" });
          field.append(
            el("label", {}, ["App-specific password"]),
            (() => {
              const input = el("input", { type: "password", autocomplete: "off" }) as HTMLInputElement;
              input.value = imapAppPassword;
              input.addEventListener("input", () => {
                imapAppPassword = input.value;
                revalidate();
              });
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

    scanBtn = el("button", { type: "button", class: "btn btn--primary" }, ["Scan"]) as HTMLButtonElement;
    scanBtn.addEventListener("click", () => void scan());
    revalidate();
    pane.append(scanBtn);
  }

  function pathField(label: string, value: string, onChange: (v: string) => void, pick: "file" | "folder" = "file"): HTMLElement {
    const field = el("div", { class: "field" });
    const row = el("div", { style: "display:flex;gap:8px;" });
    const input = el("input", { type: "text" }) as HTMLInputElement;
    input.value = value;
    input.style.flex = "1";
    input.addEventListener("input", () => onChange(input.value));
    const browse = el("button", { type: "button", class: "btn" }, [pick === "folder" ? "Choose folder…" : "Choose file…"]);
    browse.addEventListener("click", async () => {
      const picked = pick === "folder" ? await window.docket.onboarding.pickFolder() : await window.docket.onboarding.pickFile();
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
    const macBlockedHere = sweepResults.filter((r) => r.blockedOn === "macos").length;
    const igBlockedHere = sweepResults.filter((r) => r.blockedOn === "instagram").length;
    const knownHere = sweepResults.filter((r) => r.knownAccountLabel !== undefined && r.blockedOn === undefined).length;
    if (macBlockedHere > 0 || igBlockedHere > 0 || knownHere > 0) {
      const parts: string[] = [];
      if (macBlockedHere > 0) parts.push(`${macBlockedHere} ${macBlockedHere === 1 ? "is" : "are"} on your block list on this Mac`);
      if (igBlockedHere > 0) parts.push(`${igBlockedHere} ${igBlockedHere === 1 ? "is" : "are"} blocked on Instagram`);
      if (knownHere > 0) parts.push(`${knownHere} ${knownHere === 1 ? "is" : "are"} already in your known accounts`);
      pane.append(
        el("p", {}, [
          `Of these, ${parts.join(" and ")}. They're listed first and already selected. What they sent before you blocked them helps docket recognize the same person if they come back from a new number or account.`,
        ]),
      );
    }
    const blocklistNote = describeBlocklist(blocklist, macBlockedHere);
    if (blocklistNote) pane.append(el("p", { style: "font-size:12px;" }, [blocklistNote]));
    if (instagramBlocked && instagramBlocked.count > igBlockedHere) {
      const notHere = instagramBlocked.count - igBlockedHere;
      pane.append(
        el("p", { style: "font-size:12px;" }, [
          `You blocked ${notHere} other account${notHere === 1 ? "" : "s"} on Instagram with no messages in this export. Their usernames can still be saved as known accounts on the next screen.`,
        ]),
      );
    }
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
        const title = el("div", { class: "list-block-row-title", style: "display:flex;align-items:center;gap:8px;flex-wrap:wrap;" }, [r.sender]);
        if (r.blockedOn) title.append(el("span", { class: "badge badge--medium" }, [r.blockedOn === "macos" ? "Blocked on this Mac" : "Blocked on Instagram"]));
        if (r.knownAccountLabel !== undefined) title.append(el("span", { class: "provenance-pill" }, [`Known: ${r.knownAccountLabel}`]));
        row.append(
          cb,
          el("div", {}, [
            title,
            el("div", { class: "list-block-row-sub" }, [
              `${r.messageCount} message${r.messageCount === 1 ? "" : "s"} · ${r.firstSeenAt.toLocaleDateString()} – ${r.lastSeenAt.toLocaleDateString()}`,
            ]),
          ]),
        );
        list.append(row);
      }
      pane.append(list);
    }

    const igBlockedTotal = source === "instagram" ? (instagramBlocked?.count ?? 0) : 0;
    if (igBlockedTotal > 0 || sweepResults.some((r) => r.blockedOn === "macos" && selected.has(r.sender))) {
      const saveRow = el("label", { style: "display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;" });
      const saveCb = el("input", { type: "checkbox" }) as HTMLInputElement;
      saveCb.checked = saveBlockedAsKnown;
      saveCb.style.minWidth = "24px";
      saveCb.style.minHeight = "24px";
      saveCb.addEventListener("change", () => (saveBlockedAsKnown = saveCb.checked));
      saveRow.append(
        saveCb,
        el("span", {}, [
          igBlockedTotal > 0
            ? `Also save the ${igBlockedTotal} account${igBlockedTotal === 1 ? "" : "s"} I blocked on Instagram as known accounts, so OSINT can compare new senders with them`
            : "Also save the blocked senders I selected as known accounts, so OSINT can compare new senders with them",
        ]),
      );
      pane.append(saveRow);
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
    const total = savedKnown.added + savedKnown.alreadyKnown;
    if (total > 0) {
      pane.append(
        el("p", {}, [
          `Saved ${total} blocked account${total === 1 ? "" : "s"} as known accounts${savedKnown.alreadyKnown > 0 ? ` (${savedKnown.alreadyKnown} already there)` : ""}. Group them by person under OSINT → Known accounts.`,
        ]),
      );
    }
    if (saveKnownError) {
      pane.append(el("p", { style: "color:var(--high-fg);" }, [`Your messages were imported, but saving blocked senders as known accounts failed: ${saveKnownError}`]));
    }
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

function isFlagged(row: SweepRow): boolean {
  return row.blockedOn !== undefined || row.knownAccountLabel !== undefined;
}

/** One line about the block list itself, only when there's something the user should know. */
function describeBlocklist(blocklist: BlocklistSummary | undefined, blockedHere: number): string | undefined {
  if (!blocklist) return undefined;
  switch (blocklist.status) {
    case "error":
      return `Couldn't read this Mac's block list (${blocklist.error ?? "unknown error"}). You can still choose senders by hand.`;
    case "ok": {
      const notHere = blocklist.blockedCount - blockedHere;
      const skipped = blocklist.skipped > 0 ? ` ${blocklist.skipped} block list entr${blocklist.skipped === 1 ? "y" : "ies"} couldn't be read.` : "";
      return notHere > 0 || skipped
        ? `${notHere > 0 ? `${notHere} other blocked contact${notHere === 1 ? " has" : "s have"} no messages here. You can add them from OSINT → Known accounts.` : ""}${skipped}`.trim()
        : undefined;
    }
    default:
      return undefined;
  }
}

function connectHelpText(source: SourceKind): string {
  switch (source) {
    case "imessage":
      return "Reads your local Messages database directly. Only works on macOS, on this device.";
    case "android-sms":
      return "Import an XML export from the “SMS Backup & Restore” app — the standard way to get SMS history off an Android phone.";
    case "imap":
      return "Connects with an app-specific password, never your account's real password.";
    case "instagram":
      return "Import the export from Instagram's “Download your information” (Accounts Center → Your information and permissions). Choose JSON as the format and include Messages, Connections, and Personal information. Instagram can take a few days to prepare it. Unsent and deleted messages are not in the export, so they can't be recovered from it.";
  }
}
