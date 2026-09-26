import { el, ipcErrorMessage, mount } from "../dom.js";

const SIGNAL_LABEL: Record<OsintSignalKind, string> = {
  "username-reuse": "Username",
  "email-reuse": "Email",
  "phone-reuse": "Phone",
  "profile-photo-match": "Photo",
  "writing-style-match": "Writing style",
};

const FINDING_LABEL: Record<LinkFinding, string> = {
  "ip-logger": "IP logger",
  shortener: "Short link",
  malicious: "Malware",
  phishing: "Phishing",
};

const FINDING_MEANING: Record<LinkFinding, string> = {
  "ip-logger": "Opening it would show the sender your IP address and rough location.",
  shortener: "It hides where it really goes, and is often used to wrap an IP logger.",
  malicious: "It's on a list of links that spread malware.",
  phishing: "It's on a list of fake login pages.",
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
 * Unlocked state has two local tools and two online ones:
 *   - Compare with known accounts (local): checks the sender against every
 *     person in the known-accounts list — shared identifiers, and writing
 *     style against that person's own messages already in the vault.
 *   - Check a candidate (local): the user names one person they suspect
 *     and gives what they know.
 *   - Links in their messages (online on request): built-in IP-logger and
 *     shortener lists offline; public threat lists downloaded on click.
 *     Links are never opened or sent anywhere.
 *   - Where does a username exist? (online on request): asks a fixed set
 *     of sites whether a handle is taken. Added 2026-09-25 by the owner's
 *     decision, reversing the earlier local-only stance; see DESIGN.md.
 * Each online check says exactly what it contacts before it runs, and
 * runs only on a click. All four stay behind the abuse-threshold gate.
 */
export async function renderOsintScreen(container: Element): Promise<void> {
  let unlockedFor: string | undefined;
  let checked: RankedLead[] = [];
  let compared: RankedLead[] | undefined;
  let error: string | undefined;
  let knownError: string | undefined;
  let importNote: string | undefined;

  // Online checks, per unlocked sender.
  let networkInfo: OsintNetworkInfo | undefined;
  let linkVerdicts: LinkVerdict[] = [];
  let linkFeeds: FeedStatus[] | undefined;
  let linkError: string | undefined;
  let suggestions: string[] = [];
  let handleDraft = "";
  let includeSensitive = false;
  let presenceError: string | undefined;
  // The running or last username check. Progress events update it and
  // redraw only the results area, so the handle field isn't rebuilt
  // while someone is typing.
  let usernameCheck:
    | {
        checkId: number;
        handle: string;
        tier: "major" | "all";
        total: number;
        done: number;
        finished: boolean;
        outcomes: SiteOutcome[];
        notChecked: NotChecked[];
        note?: string;
      }
    | undefined;

  const stopWatchingProgress = window.docket.osint.onUsernameProgress((progress) => {
    if (!container.isConnected) {
      // The user left the OSINT screen: stop the check and stop listening.
      stopWatchingProgress();
      void window.docket.osint.stopUsernameCheck(progress.checkId);
      return;
    }
    if (!usernameCheck || usernameCheck.checkId !== progress.checkId) return;
    usernameCheck.done = progress.done;
    if (progress.outcome) usernameCheck.outcomes.push(progress.outcome);
    if (progress.finished) {
      // A full redraw re-enables the buttons only if the handle is still valid.
      usernameCheck.finished = true;
      draw();
      return;
    }
    const region = container.querySelector("#username-results");
    if (region) region.replaceWith(usernameResults());
  });

  const eligibility = await window.docket.osint.eligibleSenders();
  let known = await window.docket.knownAccounts.list();

  async function reloadKnown(): Promise<void> {
    known = await window.docket.knownAccounts.list();
    draw();
  }

  async function unlock(sender: string): Promise<void> {
    unlockedFor = sender;
    checked = [];
    compared = undefined;
    error = undefined;
    linkFeeds = undefined;
    linkError = undefined;
    if (usernameCheck && !usernameCheck.finished) void window.docket.osint.stopUsernameCheck(usernameCheck.checkId);
    usernameCheck = undefined;
    presenceError = undefined;
    try {
      // Nothing here touches the network: the static list of what the
      // online checks would contact, the offline link check, and handle
      // suggestions from the sender's own messages.
      [networkInfo, linkVerdicts, suggestions] = await Promise.all([
        window.docket.osint.networkInfo(),
        window.docket.osint.linkReport(sender),
        window.docket.osint.usernameSuggestions(sender),
      ]);
      handleDraft = suggestions[0] ?? "";
    } catch (err) {
      error = ipcErrorMessage(err);
    }
    draw();
  }

  async function checkLinks(sender: string, button: HTMLButtonElement): Promise<void> {
    linkError = undefined;
    button.disabled = true;
    button.textContent = "Downloading lists…";
    try {
      const result = await window.docket.osint.checkLinksOnline(sender);
      linkVerdicts = result.verdicts;
      linkFeeds = result.feeds;
    } catch (err) {
      linkError = ipcErrorMessage(err);
    }
    draw();
  }

  async function startUsernameCheck(sender: string, handle: string, tier: "major" | "all"): Promise<void> {
    presenceError = undefined;
    container.querySelectorAll<HTMLButtonElement>(".username-start").forEach((button) => (button.disabled = true));
    try {
      const started = await window.docket.osint.startUsernameCheck(sender, { handle, tier, includeSensitive: tier === "all" && includeSensitive });
      usernameCheck = {
        checkId: started.checkId,
        handle,
        tier,
        total: started.total,
        done: 0,
        finished: started.total === 0,
        outcomes: [],
        notChecked: started.notChecked,
        ...(started.note ? { note: started.note } : {}),
      };
    } catch (err) {
      presenceError = ipcErrorMessage(err);
    }
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
        btn.addEventListener("click", () => void unlock(e.sender));
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

  function drawLinks(pane: HTMLElement, sender: string): void {
    pane.append(el("h3", { class: "subsection-heading" }, ["Links in their messages"]));
    if (linkVerdicts.length === 0) {
      pane.append(el("p", {}, ["There are no links in their messages."]));
      return;
    }
    pane.append(
      el("p", {}, [
        "Don't open these. An IP-logging link shows its owner where you are the moment it loads. This check never opens them either.",
      ]),
    );
    const list = el("div", { class: "list-block" });
    for (const verdict of linkVerdicts) {
      const row = el("div", { class: "list-block-row" });
      row.append(el("div", { class: "list-block-row-title selectable", style: "overflow-wrap:anywhere;" }, [verdict.link.text]));
      if (verdict.findings.length === 0) {
        row.append(el("div", { class: "list-block-row-sub" }, [linkFeeds ? "Not on any list that was checked." : "Not on the built-in lists."]));
      }
      // One line per kind of finding, naming every list that agreed.
      const sourcesByKind = new Map<LinkFinding, string[]>();
      for (const finding of verdict.findings) sourcesByKind.set(finding.kind, [...(sourcesByKind.get(finding.kind) ?? []), finding.source]);
      for (const [kind, sources] of sourcesByKind) {
        row.append(
          el("div", { class: "list-block-row-sub link-finding" }, [
            el("span", { class: `badge ${kind === "shortener" ? "badge--medium" : "badge--high"}` }, [FINDING_LABEL[kind]]),
            ` ${FINDING_MEANING[kind]} Listed by: ${sources.join(", ")}.`,
          ]),
        );
      }
      list.append(row);
    }
    pane.append(list);

    if (!linkFeeds) {
      const feeds = networkInfo?.linkFeeds ?? [];
      pane.append(
        el("p", { class: "network-notice" }, [
          `Checking against public threat lists downloads ${feeds.length} lists from their publishers (${feeds.map((f) => f.name).join("; ")}) over your internet connection, then compares the links on this device. The links themselves aren't sent anywhere.`,
        ]),
      );
      const button = el("button", { type: "button", class: "btn btn--inline" }, ["Check against public threat lists"]) as HTMLButtonElement;
      button.addEventListener("click", () => void checkLinks(sender, button));
      pane.append(button);
    } else {
      const failed = linkFeeds.filter((f) => !f.ok);
      pane.append(
        el("p", { style: "font-size:12px;" }, [
          failed.length === 0
            ? `Checked against ${linkFeeds.length} public lists.`
            : `Checked against ${linkFeeds.length - failed.length} of ${linkFeeds.length} lists. Not checked: ${failed.map((f) => `${f.name} (${f.detail})`).join("; ")}.`,
        ]),
      );
    }
    if (linkError) pane.append(el("p", { class: "field-error" }, [linkError]));
  }

  /** The results area of the username check; rebuilt on each progress event. */
  function usernameResults(): HTMLElement {
    const region = el("div", { id: "username-results", class: "username-results", "aria-live": "polite" });
    const check = usernameCheck;
    if (!check) return region;

    const found = check.outcomes.filter((o) => o.status === "found");
    const unknown = check.outcomes.filter((o) => o.status === "unknown");
    const missing = check.outcomes.filter((o) => o.status === "not-found");

    if (!check.finished) {
      const stop = el("button", { type: "button", class: "btn btn--inline" }, ["Stop"]);
      stop.addEventListener("click", () => void window.docket.osint.stopUsernameCheck(check.checkId));
      region.append(el("div", { class: "username-progress" }, [el("span", {}, [`Checking "${check.handle}": ${check.done} of ${check.total} sites…`]), stop]));
    } else {
      region.append(el("p", { style: "font-size:12px;" }, [`"${check.handle}": taken on ${found.length} of ${check.total} sites checked.`]));
    }
    if (check.note) region.append(el("p", { style: "font-size:12px;" }, [check.note]));

    if (found.length > 0) {
      const list = el("div", { class: "list-block" });
      for (const outcome of found) {
        list.append(
          el("div", { class: "list-block-row" }, [
            el("div", { class: "list-block-row-title" }, [outcome.site]),
            el("div", { class: "list-block-row-sub" }, ["An account with this name exists."]),
            ...(outcome.profileUrl ? [el("div", { class: "list-block-row-sub selectable", style: "overflow-wrap:anywhere;" }, [outcome.profileUrl])] : []),
          ]),
        );
      }
      region.append(list);
    } else if (check.finished) {
      region.append(el("div", { class: "empty-state" }, ["No site that answered clearly has an account with this name."]));
    }

    const detailList = (summary: string, rows: string[]) =>
      el("details", { class: "revision-history" }, [el("summary", {}, [summary]), el("ul", { class: "plain-list" }, rows.map((r) => el("li", {}, [r])))]);
    if (unknown.length > 0) region.append(detailList(`Couldn't tell on ${unknown.length} site${unknown.length === 1 ? "" : "s"}`, unknown.map((o) => `${o.site}: ${o.detail ?? "no clear answer"}`)));
    if (missing.length > 0) region.append(detailList(`No account on ${missing.length} site${missing.length === 1 ? "" : "s"}`, missing.map((o) => o.site)));
    if (check.notChecked.length > 0) region.append(detailList(`Not checked: ${check.notChecked.length}`, check.notChecked.map((n) => `${n.name}: ${n.reason}`)));
    return region;
  }

  function drawUsername(pane: HTMLElement, sender: string): void {
    pane.append(
      el("h3", { class: "subsection-heading" }, ["Where does a username exist?"]),
      el("p", {}, [
        "Checks whether an account with this exact name exists on other sites. A match only means the name is taken there. It doesn't show that it's the same person.",
      ]),
    );
    const info = networkInfo?.username;
    if (!info) {
      pane.append(el("p", { class: "field-error" }, [`The username check isn't available: ${networkInfo?.usernameError ?? "its site rules didn't load"}`]));
      return;
    }

    const input = el("input", { type: "text", id: "osint-handle", list: "osint-handle-suggestions", autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
    input.value = handleDraft;
    const datalist = el("datalist", { id: "osint-handle-suggestions" }, suggestions.map((h) => el("option", { value: h })));
    const valid = (value: string) => /^@?[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/.test(value.trim());
    const running = usernameCheck !== undefined && !usernameCheck.finished;

    const majorButton = el("button", { type: "button", class: "btn btn--inline username-start" }, [`Check ${info.majorSites.length} major platforms`]) as HTMLButtonElement;
    const sweepCount = () => info.allCount + (includeSensitive ? info.sensitiveCount : 0);
    const sweepButton = el("button", { type: "button", class: "btn btn--inline username-start" }, [`Check all ${sweepCount()} sites`]) as HTMLButtonElement;
    const refresh = () => {
      const disabled = running || !valid(input.value);
      majorButton.disabled = disabled;
      sweepButton.disabled = disabled;
      sweepButton.textContent = `Check all ${sweepCount()} sites`;
    };
    input.addEventListener("input", () => {
      handleDraft = input.value;
      refresh();
    });
    const handle = () => input.value.trim().replace(/^@/, "");
    majorButton.addEventListener("click", () => void startUsernameCheck(sender, handle(), "major"));
    sweepButton.addEventListener("click", () => void startUsernameCheck(sender, handle(), "all"));

    const sensitive = el("input", { type: "checkbox", id: "osint-sensitive" }) as HTMLInputElement;
    sensitive.checked = includeSensitive;
    sensitive.addEventListener("change", () => {
      includeSensitive = sensitive.checked;
      refresh();
    });
    refresh();

    const categories = Object.entries(info.categories)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, n]) => `${cat} ${n}`)
      .join(", ");
    const notChecked = info.majorNotChecked.map((n) => n.name).join(", ");

    pane.append(
      el("div", { class: "field" }, [el("label", { for: "osint-handle" }, ["Username"]), input, datalist]),
      el("p", { class: "network-notice" }, [
        `Sends the username to these ${info.majorSites.length} sites over your internet connection, and each of them can see your IP address: ${info.majorSites.join(", ")}.${notChecked ? ` Not checked, because their rules didn't pass docket's testing: ${notChecked}.` : ""}`,
      ]),
      majorButton,
      el("p", { class: "network-notice" }, [
        `Or check every site in WhatsMyName's list that passed docket's testing: ${info.allCount} sites (${categories}). It can take up to 3 minutes, and every one of those sites sees your IP address.`,
      ]),
      el("label", { class: "choice sensitive-choice", for: "osint-sensitive" }, [
        sensitive,
        el("span", {}, [
          `Also check dating, adult, health, and political sites (${info.sensitiveCount} more). Off by default: a match there says something private about whoever owns the name, who may not be the person harassing you.`,
        ]),
      ]),
      sweepButton,
    );
    if (presenceError) pane.append(el("p", { class: "field-error" }, [presenceError]));
    pane.append(usernameResults());
    pane.append(
      el("p", { class: "attribution" }, [
        `Site rules: ${info.attribution.source}, ${info.attribution.license}, commit ${info.attribution.revision.slice(0, 7)}${info.attribution.verifiedAt ? `, tested by docket on ${info.attribution.verifiedAt}` : ""}.`,
      ]),
    );
  }

  function drawOnlineChecks(pane: HTMLElement, sender: string): void {
    pane.append(
      el("h2", { class: "section-heading" }, ["Online checks"]),
      el("p", {}, [
        "These are the only parts of the app that use the internet, and each one runs only when you click it. Nothing from your messages is sent except what each button names.",
      ]),
    );
    drawLinks(pane, sender);
    drawUsername(pane, sender);
  }

  function drawUnlocked(pane: HTMLElement, sender: string): void {
    pane.append(
      el("h1", { style: "margin:0 0 8px;" }, [`OSINT for ${sender}`]),
      el("p", {}, [
        "Results here are unverified leads, never a confirmed identity, and are structurally barred from any evidence export. The first two tools use only messages already on this device. The online checks below use the internet, only when you click them.",
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

    // Online checks last, after both local tools.
    drawOnlineChecks(pane, sender);

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
