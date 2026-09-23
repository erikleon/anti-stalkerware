import { el, mount } from "../dom.js";
import { ICONS } from "../icons.js";

export interface LockScreenOptions {
  mode: "create" | "unlock";
  error?: string;
  onSubmit: (passphrase: string) => void;
  onHelp: () => void;
}

/**
 * The disguise screen (D5) — the fake title bar is the only thing visible
 * in a dock, alt-tab, or over someone's shoulder. "Help" is reachable here,
 * before the passphrase field: crisis help and vault security are two
 * different needs, and gating one behind the other is a mistake regardless
 * of how sound the rest of the security model is. It's labeled just "Help"
 * so it reads as an ordinary app-support link, not a crisis-specific one —
 * see DESIGN.md's "Support and resources" section.
 */
export function renderLockScreen(container: Element, options: LockScreenOptions): void {
  let reveal = false;

  function draw(): void {
    const root = el("div", { class: "lock-screen" });

    const titlebar = el("div", { class: "lock-screen-titlebar" });
    const wordmark = el("div", { style: "display:flex;align-items:center;gap:8px;" });
    const icon = el("span", { "aria-hidden": "true" });
    icon.innerHTML = ICONS.wordmark;
    wordmark.append(icon, el("span", {}, ["Ledger"]));
    const help = el("a", { href: "#" }, ["Help"]);
    help.addEventListener("click", (e) => {
      e.preventDefault();
      options.onHelp();
    });
    titlebar.append(wordmark, help);

    const body = el("div", { class: "lock-screen-body" });
    const heading = el("div", { style: "display:flex;flex-direction:column;align-items:center;gap:10px;" });
    const headingIcon = el("span", { "aria-hidden": "true" });
    headingIcon.innerHTML = ICONS.wordmark;
    const title = el("h1", { style: "margin:0;font-size:16px;font-weight:600;" }, ["Ledger"]);
    const subtitle = el(
      "p",
      { style: "margin:0;font-size:13px;color:var(--text-dim);" },
      [options.mode === "create" ? "Create a passphrase to set up your vault" : "Enter your passphrase to continue"],
    );
    heading.append(headingIcon, title, subtitle);

    const form = el("form", { class: "field", style: "width:100%;" });
    const label = el("label", { for: "pass" }, ["Passphrase"]);
    const inputRow = el("div", { style: "display:flex;gap:8px;" });
    const input = el("input", {
      id: "pass",
      name: "pass",
      type: reveal ? "text" : "password",
      autocomplete: "off",
      style: "flex:1;",
    }) as HTMLInputElement;
    const toggle = el(
      "button",
      { type: "button", class: "btn", "aria-label": reveal ? "Hide passphrase" : "Show passphrase" },
      [reveal ? "Hide" : "Show"],
    );
    toggle.addEventListener("click", () => {
      reveal = !reveal;
      draw();
    });
    inputRow.append(input, toggle);

    const submit = el("button", { type: "submit", class: "btn btn--primary", style: "margin-top:6px;" }, [
      options.mode === "create" ? "Create vault" : "Unlock",
    ]);

    form.append(label, inputRow, submit);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (input.value.length > 0) options.onSubmit(input.value);
    });

    body.append(heading, form);

    if (options.error) {
      body.append(el("p", { style: "margin:0;font-size:12.5px;color:var(--high-fg);text-align:center;" }, [options.error]));
    }

    body.append(
      el(
        "p",
        { style: "margin:0;font-size:11.5px;color:var(--text-dim);text-align:center;line-height:1.6;max-width:340px;" },
        [
          "This passphrase is separate from your device login and cannot be recovered if lost — see the setup guide before you need it.",
        ],
      ),
    );

    root.append(titlebar, body);
    mount(container, root);
    input.focus();
  }

  draw();
}
