import { el, ipcErrorMessage, mount } from "../dom.js";

const SIGNAL_LABEL: Record<OsintSignalKind, string> = {
  "username-reuse": "Username",
  "email-reuse": "Email",
  "phone-reuse": "Phone",
  "profile-photo-match": "Photo",
  "writing-style-match": "Writing style",
};

/**
 * Locked state lists every vault sender with their gate eligibility, and
 * states plainly this is friction against casual misuse, not verification
 * (D22's own language). Selecting an eligible sender moves to the
 * "unlocked" view for that sender.
 *
 * Unlocked state is verify-mode, not search-mode (see DESIGN.md's OSINT
 * collector decision): the user names a candidate they already suspect —
 * a username, email, phone, and/or a pasted writing sample they believe
 * is that person's own words — and the app checks only whether that
 * specific hypothesis is supported by what the sender themselves was
 * identified by or wrote. It cannot look anyone up from a bare
 * identifier; there is no "find out who this is" button here, on
 * purpose. Every check runs entirely against vault data already on this
 * device — no network call, no external lookup — which is why this
 * screen makes no "generates internet traffic" claim; the mockup's
 * traffic indicator was written for a design this one deliberately isn't.
 */
export async function renderOsintScreen(container: Element): Promise<void> {
  let unlockedFor: string | undefined;
  let checked: RankedLead[] = [];
  let error: string | undefined;

  const eligibility = await window.docket.osint.eligibleSenders();

  function unlock(sender: string): void {
    unlockedFor = sender;
    checked = [];
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

  function field(labelText: string, placeholder: string): { wrap: HTMLElement; input: HTMLInputElement } {
    const input = el("input", { type: "text", placeholder }) as HTMLInputElement;
    const wrap = el("div", { class: "field" }, [el("label", {}, [labelText]), input]);
    return { wrap, input };
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
      return;
    }
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

  function drawUnlocked(pane: HTMLElement, sender: string): void {
    pane.append(
      el("h1", { style: "margin:0 0 8px;" }, [`Check a candidate for ${sender}`]),
      el("p", {}, [
        "Name someone you already suspect. This can only confirm or weaken that one hypothesis using messages already in your vault — it can't search for who someone is, and it never makes a network call.",
      ]),
      el("p", {}, [
        "Results are unverified leads, never a confirmed identity, and are structurally barred from any evidence export.",
      ]),
    );

    if (error) pane.append(el("p", { style: "color:var(--high-fg);" }, [error]));

    const labelField = field("Who do you think this is?", "e.g. my coworker Alex");
    const usernameField = field("Known username (optional)", "");
    const emailField = field("Known email (optional)", "");
    const phoneField = field("Known phone (optional)", "");
    const sampleField = el("div", { class: "field" }, [
      el("label", {}, ["A writing sample you believe is theirs (optional)"]),
      el("textarea", { rows: "3", placeholder: "Paste text you believe this person actually wrote" }),
    ]);
    const sampleInput = sampleField.querySelector("textarea") as HTMLTextAreaElement;

    const form = el("div", { style: "display:flex;flex-direction:column;gap:12px;margin-top:8px;" });
    form.append(labelField.wrap, usernameField.wrap, emailField.wrap, phoneField.wrap, sampleField);

    const checkBtn = el("button", { type: "button", class: "btn btn--primary" }, ["Check this candidate"]) as HTMLButtonElement;
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
      pane.append(el("h1", { style: "font-size:13px;margin-top:16px;" }, ["Checked so far"]));
      const list = el("div", { class: "list-block" });
      for (const lead of checked) {
        const row = el("div", { class: "list-block-row" });
        row.append(
          el("div", { class: "list-block-row-title" }, [lead.candidateId]),
          el("div", { class: "list-block-row-sub" }, [
            lead.supportingSignalCount === 0
              ? "No supporting signals found for what you entered."
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
      pane.append(list);
    }

    const back = el("a", { href: "#", style: "font-size:12px;color:var(--text-dim);display:block;margin-top:16px;" }, ["← Back to senders"]);
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
