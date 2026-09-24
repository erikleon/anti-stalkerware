import { el, ipcErrorMessage, mount } from "../dom.js";

const SIGNAL_LABEL: Record<OsintSignalKind, string> = {
  "username-reuse": "Username",
  "email-reuse": "Email",
  "phone-reuse": "Phone",
  "profile-photo-match": "Photo",
  "writing-style-match": "Writing style",
};

const KIND_LABEL: Record<KnownAccountKind, string> = {
  phone: "Phone",
  email: "Email",
  username: "Username",
};

const ORIGIN_LABEL: Record<KnownAccountOrigin, string> = {
  manual: "Added by you",
  "macos-blocklist": "Blocked on this Mac",
  "instagram-blocklist": "Blocked on Instagram",
};

/**
 * Locked state lists every vault sender with their gate eligibility, and
 * states plainly this is friction against casual misuse, not verification
 * (D22's own language). Selecting an eligible sender moves to the
 * "unlocked" view for that sender. Below the senders is the known-accounts
 * list: accounts the user already knows belong to someone harassing them,
 * usually ones they blocked.
 *
 * Unlocked state is verify-mode, not search-mode (see DESIGN.md's OSINT
 * collector decision). Two tools, both local-only:
 *   - Compare with known accounts: checks the sender against every person
 *     in the known-accounts list at once — shared identifiers, and writing
 *     style against that person's own messages already in the vault.
 *   - Check a candidate: the user names one person they suspect and gives
 *     what they know (a username, email, phone, or a pasted writing
 *     sample).
 * Neither can look anyone up from a bare identifier; there is no "find
 * out who this is" button here, on purpose. Every check runs against
 * vault data already on this device — no network call — which is why
 * this screen makes no "generates internet traffic" claim.
 */
export async function renderOsintScreen(container: Element): Promise<void> {
  let unlockedFor: string | undefined;
  let checked: RankedLead[] = [];
  let compared: RankedLead[] | undefined;
  let error: string | undefined;
  let knownError: string | undefined;
  let importNote: string | undefined;

  const eligibility = await window.docket.osint.eligibleSenders();
  let known = await window.docket.knownAccounts.list();

  async function reloadKnown(): Promise<void> {
    known = await window.docket.knownAccounts.list();
    draw();
  }

  function unlock(sender: string): void {
    unlockedFor = sender;
    checked = [];
    compared = undefined;
    error = undefined;
    draw();
  }

  // Deliberately doesn't redraw before the IPC call resolves — a redraw
  // rebuilds every input fresh, which would wipe whatever the user just
  // typed out from under them the moment they click Check. The button
  // itself is mutated directly instead (same reasoning as onboarding.ts's
  // revalidate()), and the full pane only redraws once with the result.
  async function checkCandidate(sender: string, input: CandidateInput, button: HTMLButtonElement): Promise<void> {
    error = undefined;
    button.disabled = true;
    button.textContent = "Checking…";
    try {
      const result = await window.docket.osint.checkCandidate(sender, input);
      checked = [...checked, result].sort((a, b) => b.score - a.score);
    } catch (err) {
      error = ipcErrorMessage(err);
    }
    draw();
  }

  async function compareKnown(sender: string, button: HTMLButtonElement): Promise<void> {
    error = undefined;
    button.disabled = true;
    button.textContent = "Comparing…";
    try {
      compared = await window.docket.osint.compareKnownAccounts(sender);
    } catch (err) {
      error = ipcErrorMessage(err);
    }
    draw();
  }

  async function runKnownAction(action: () => Promise<unknown>): Promise<void> {
    knownError = undefined;
    try {
      await action();
    } catch (err) {
      knownError = ipcErrorMessage(err);
    }
    await reloadKnown();
  }

  async function importBlocklist(button: HTMLButtonElement): Promise<void> {
    knownError = undefined;
    importNote = undefined;
    button.disabled = true;
    button.textContent = "Importing…";
    try {
      const result = await window.docket.knownAccounts.importMacosBlocklist();
      importNote = describeImport(result);
    } catch (err) {
      knownError = ipcErrorMessage(err);
    }
    await reloadKnown();
  }

  let fieldCount = 0;
  function field(labelText: string, placeholder: string): { wrap: HTMLElement; input: HTMLInputElement } {
    const id = `osint-field-${fieldCount++}`;
    const input = el("input", { type: "text", placeholder, id }) as HTMLInputElement;
    const wrap = el("div", { class: "field" }, [el("label", { for: id }, [labelText]), input]);
    return { wrap, input };
  }

  function leadList(leads: readonly RankedLead[]): HTMLElement {
    const list = el("div", { class: "list-block" });
    for (const lead of leads) {
      const row = el("div", { class: "list-block-row" });
      row.append(
        el("div", { class: "list-block-row-title" }, [lead.candidateId]),
        el("div", { class: "list-block-row-sub" }, [
          lead.supportingSignalCount === 0
            ? "No supporting signals found."
            : `${(lead.score * 100).toFixed(0)}% · ${lead.supportingSignalCount} supporting signal${lead.supportingSignalCount === 1 ? "" : "s"}`,
        ]),
      );
      if (lead.signals.length > 0) {
        const sigList = el("div", { style: "margin-top:6px;display:flex;flex-direction:column;gap:2px;" });
        for (const signal of lead.signals) {
          sigList.append(
            el("div", { style: "font-size:11px;color:var(--text-dim);" }, [
              `${SIGNAL_LABEL[signal.kind]} (${(signal.confidence * 100).toFixed(0)}%) — ${signal.source}`,
            ]),
          );
        }
        row.append(sigList);
      }
      list.append(row);
    }
    return list;
  }

  function drawKnownAccounts(pane: HTMLElement): void {
    pane.append(
      el("h2", { class: "section-heading" }, ["Known accounts"]),
      el("p", {}, [
        "Numbers, emails, and usernames you know belong to someone harassing you — often ones you blocked. Give accounts the same person name to compare them as one person. OSINT compares a flagged sender with each person here, using only messages already in your vault.",
      ]),
    );
    if (knownError) pane.append(el("p", { style: "color:var(--high-fg);" }, [knownError]));
    if (importNote) pane.append(el("p", {}, [importNote]));

    if (known.length === 0) {
      pane.append(el("div", { class: "empty-state" }, ["No known accounts yet. Add one below, or import the contacts you blocked."]));
    } else {
      const list = el("div", { class: "list-block" });
      for (const account of known) {
        const row = el("div", { class: "list-block-row", style: "flex-direction:row;align-items:center;justify-content:space-between;gap:12px;" });
        const personInput = el("input", { type: "text", "aria-label": `Person for ${account.value}` }) as HTMLInputElement;
        personInput.value = account.personLabel;
        personInput.style.maxWidth = "180px";
        personInput.addEventListener("change", () => {
          const next = personInput.value.trim();
          if (next.length === 0 || next === account.personLabel) {
            personInput.value = account.personLabel;
            return;
          }
          void runKnownAction(() => window.docket.knownAccounts.setPersonLabel(account.id, next));
        });
        const removeBtn = el("button", { type: "button", class: "btn" }, ["Remove"]);
        removeBtn.addEventListener("click", () => void runKnownAction(() => window.docket.knownAccounts.remove(account.id)));
        row.append(
          el("div", { style: "min-width:0;" }, [
            el("div", { class: "list-block-row-title", style: "overflow-wrap:anywhere;" }, [account.value]),
            el("div", { class: "list-block-row-sub" }, [`${KIND_LABEL[account.kind]} · ${ORIGIN_LABEL[account.origin]}`]),
          ]),
          el("div", { class: "field field--inline" }, [personInput, removeBtn]),
        );
        list.append(row);
      }
      pane.append(list);
    }

    const personField = field("Person", "e.g. my ex");
    const valueField = field("Number, email, or username", "");
    const kindSelect = el("select", { "aria-label": "Account type" }) as HTMLSelectElement;
    for (const kind of Object.keys(KIND_LABEL) as KnownAccountKind[]) {
      kindSelect.append(el("option", { value: kind }, [KIND_LABEL[kind]]));
    }
    const kindField = el("div", { class: "field" }, [el("label", {}, ["Type"]), kindSelect]);
    const addBtn = el("button", { type: "button", class: "btn btn--inline" }, ["Add known account"]) as HTMLButtonElement;
    const revalidate = () => {
      addBtn.disabled = personField.input.value.trim().length === 0 || valueField.input.value.trim().length === 0;
    };
    personField.input.addEventListener("input", revalidate);
    valueField.input.addEventListener("input", revalidate);
    revalidate();
    addBtn.addEventListener("click", () => {
      const kind = kindSelect.value as KnownAccountKind;
      void runKnownAction(() => window.docket.knownAccounts.add(personField.input.value, kind, valueField.input.value));
    });
    const addForm = el("div", { style: "display:flex;flex-direction:column;gap:12px;" }, [personField.wrap, kindField, valueField.wrap, addBtn]);
    pane.append(addForm);

    if (navigator.userAgent.includes("Macintosh")) {
      const importBtn = el("button", { type: "button", class: "btn btn--inline" }, ["Import contacts I blocked on this Mac"]) as HTMLButtonElement;
      importBtn.addEventListener("click", () => void importBlocklist(importBtn));
      pane.append(importBtn);
    }
  }

  function drawLocked(pane: HTMLElement): void {
    pane.append(
      el("h1", {}, ["OSINT"]),
      el("p", {}, [
        "Checking a sender here is friction against casual misuse, not proof that they're your abuser. It only unlocks for a sender already flagged in your vault.",
      ]),
    );
    if (eligibility.length === 0) {
      pane.append(el("div", { class: "empty-state" }, ["No senders in the vault yet."]));
    } else {
      const list = el("div", { class: "list-block" });
      for (const e of eligibility) {
        const row = el("div", { class: "list-block-row", style: "flex-direction:row;align-items:center;justify-content:space-between;" });
        row.append(
          el("div", {}, [
            el("div", { class: "list-block-row-title" }, [e.sender]),
            el("div", { class: "list-block-row-sub" }, [e.eligible ? "Crossed the abuse threshold" : "Not eligible yet"]),
          ]),
        );
        const btn = el("button", { type: "button", class: "btn", ...(e.eligible ? {} : { disabled: "true" }) }, [
          e.eligible ? "Check" : "Locked",
        ]) as HTMLButtonElement;
        if (!e.eligible) btn.disabled = true;
        btn.addEventListener("click", () => unlock(e.sender));
        row.append(btn);
        list.append(row);
      }
      pane.append(list);
    }
    drawKnownAccounts(pane);
  }

  function drawCompare(pane: HTMLElement, sender: string): void {
    pane.append(el("h2", { class: "section-heading" }, ["Compare with your known accounts"]));
    const people = new Set(known.map((a) => a.personLabel)).size;
    if (people === 0) {
      pane.append(el("p", {}, ["You have no known accounts yet. Add the accounts you blocked from the OSINT screen, then come back."]));
      return;
    }
    pane.append(
      el("p", {}, [
        `Checks ${sender} against ${people} ${people === 1 ? "person" : "people"} in your known accounts: shared numbers, emails, or usernames, and writing style against what each of them already sent you.`,
      ]),
    );
    const compareBtn = el("button", { type: "button", class: "btn btn--primary btn--inline" }, ["Compare"]) as HTMLButtonElement;
    compareBtn.addEventListener("click", () => void compareKnown(sender, compareBtn));
    pane.append(compareBtn);

    if (compared) {
      const supported = compared.filter((lead) => lead.supportingSignalCount > 0);
      const unsupported = compared.length - supported.length;
      if (supported.length === 0) {
        pane.append(el("div", { class: "empty-state" }, ["Nothing in your vault links this sender to anyone in your known accounts."]));
      } else {
        pane.append(leadList(supported));
      }
      if (unsupported > 0 && supported.length > 0) {
        pane.append(el("p", { style: "font-size:12px;" }, [`${unsupported} other ${unsupported === 1 ? "person" : "people"} had no supporting signals.`]));
      }
    }
  }

  function drawUnlocked(pane: HTMLElement, sender: string): void {
    pane.append(
      el("h1", { style: "margin:0 0 8px;" }, [`OSINT for ${sender}`]),
      el("p", {}, [
        "These tools can only confirm or weaken a link you already suspect, using messages already in your vault. They can't search for who someone is, and they never make a network call. Results are unverified leads, never a confirmed identity, and are structurally barred from any evidence export.",
      ]),
    );

    if (error) pane.append(el("p", { style: "color:var(--high-fg);" }, [error]));

    drawCompare(pane, sender);

    pane.append(
      el("h2", { class: "section-heading" }, ["Check someone you suspect"]),
      el("p", {}, ["Name one person and give what you know about them."]),
    );
    const labelField = field("Who do you think this is?", "e.g. my coworker Alex");
    const usernameField = field("Known username (optional)", "");
    const emailField = field("Known email (optional)", "");
    const phoneField = field("Known phone (optional)", "");
    const sampleField = el("div", { class: "field" }, [
      el("label", {}, ["A writing sample you believe is theirs (optional)"]),
      el("textarea", { rows: "3", placeholder: "Paste text you believe this person actually wrote" }),
    ]);
    const sampleInput = sampleField.querySelector("textarea") as HTMLTextAreaElement;

    const form = el("div", { style: "display:flex;flex-direction:column;gap:12px;" });
    form.append(labelField.wrap, usernameField.wrap, emailField.wrap, phoneField.wrap, sampleField);

    const checkBtn = el("button", { type: "button", class: "btn btn--primary btn--inline" }, ["Check this candidate"]) as HTMLButtonElement;
    checkBtn.disabled = labelField.input.value.trim().length === 0;
    labelField.input.addEventListener("input", () => {
      checkBtn.disabled = labelField.input.value.trim().length === 0;
    });
    checkBtn.addEventListener("click", () => {
      const input: CandidateInput = { label: labelField.input.value };
      const username = usernameField.input.value.trim();
      if (username) input.username = username;
      const email = emailField.input.value.trim();
      if (email) input.email = email;
      const phone = phoneField.input.value.trim();
      if (phone) input.phone = phone;
      const writingSample = sampleInput.value.trim();
      if (writingSample) input.writingSample = writingSample;
      void checkCandidate(sender, input, checkBtn);
    });
    form.append(checkBtn);
    pane.append(form);

    if (checked.length > 0) {
      pane.append(el("h2", { class: "section-heading" }, ["Checked so far"]), leadList(checked));
    }

    const back = el("a", { href: "#", style: "font-size:12px;color:var(--text-dim);display:block;" }, ["← Back to senders"]);
    back.addEventListener("click", (e) => {
      e.preventDefault();
      unlockedFor = undefined;
      draw();
    });
    pane.append(back);
  }

  function draw(): void {
    const pane = el("div", { class: "content-pane" });
    if (!unlockedFor) drawLocked(pane);
    else drawUnlocked(pane, unlockedFor);
    mount(container, pane);
  }

  draw();
}

function describeImport(result: KnownAccountImportResult): string {
  switch (result.status) {
    case "unsupported-platform":
      return "Importing a block list only works on macOS.";
    case "not-found":
      return "This Mac has no block list — nobody has been blocked in Messages here, or iCloud hasn't synced one yet.";
    case "error":
      return `Couldn't read this Mac's block list: ${result.error ?? "unknown error"}`;
    case "ok": {
      const skipped = result.skipped > 0 ? ` ${result.skipped} entr${result.skipped === 1 ? "y" : "ies"} couldn't be read.` : "";
      return `Added ${result.added} blocked contact${result.added === 1 ? "" : "s"}${result.alreadyKnown > 0 ? ` (${result.alreadyKnown} already known)` : ""}. Each starts as its own person — give accounts the same person name to group them.${skipped}`;
    }
  }
}
