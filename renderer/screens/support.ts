import { el, mount } from "../dom.js";

/**
 * Crisis resources — see DESIGN.md "Support and resources". Every number
 * here was checked against its own official page, not assumed from
 * memory. Rendered both from the lock screen (no `back` callback needed
 * there beyond a plain back link) and from inside the unlocked app nav.
 */
export async function renderSupportScreen(container: Element, options: { onBack?: () => void } = {}): Promise<void> {
  const hotkeyActive = await window.antistalker.support.hotkeyStatus();
  const pane = el("div", { class: "content-pane" });

  if (options.onBack) {
    const back = el("a", { href: "#", style: "font-size:12px;color:var(--text-dim);" }, ["← Back"]);
    back.addEventListener("click", (e) => {
      e.preventDefault();
      options.onBack?.();
    });
    pane.append(back);
  }

  pane.append(
    el("h1", {}, ["Support and resources"]),
    el("p", {}, [
      "Free, confidential help is available any time, whether or not you use anything else in this app. These are national US services — if you're elsewhere, search for a local equivalent.",
    ]),
  );

  const list = el("div", { class: "list-block" });
  const resources: Array<{ title: string; detail: string; note: string }> = [
    {
      title: "National Domestic Violence Hotline",
      detail: "Call 1-800-799-7233 · Text START to 88788 · thehotline.org",
      note: "24/7, confidential",
    },
    {
      title: "Crisis Text Line",
      detail: "Text HOME to 741741",
      note: "24/7, free, confidential — not DV-specific, covers any crisis",
    },
    {
      title: "RAINN National Sexual Assault Hotline",
      detail: "Call 1-800-656-4673 · Text HOPE to 64673 · rainn.org/hotline",
      note: "24/7, confidential, English and Spanish",
    },
  ];
  for (const r of resources) {
    list.append(
      el("div", { class: "list-block-row" }, [
        el("div", { class: "list-block-row-title" }, [r.title]),
        el("div", { class: "list-block-row-sub" }, [r.detail]),
        el("div", { style: "font-size:11px;color:var(--text-dim);" }, [r.note]),
      ]),
    );
  }
  pane.append(list);

  pane.append(el("p", {}, ["If you're in immediate physical danger, contact local emergency services."]));

  pane.append(
    el("h1", { style: "font-size:13px;margin-top:8px;" }, ["If someone is forcing you to unlock this"]),
    el("p", {}, [
      "There's no hidden second passphrase here that opens a fake or empty vault. Typing the real passphrase opens the real vault; anything else just fails. A decoy that gets noticed can make a dangerous situation worse — so this app doesn't try to have one.",
    ]),
    el("p", {}, [
      "Your safety comes first. If you're physically forced to unlock a device, it's reasonable to comply. The best defense is not being caught with it open in the first place — press Ctrl+Shift+Esc (⌘+Shift+Esc on a Mac) any time to hide the window instantly, before anyone can demand you unlock it at all.",
    ]),
    el("p", { style: `font-size:12px;color:${hotkeyActive ? "var(--text-dim)" : "var(--high-fg)"};` }, [
      hotkeyActive
        ? "That hotkey is active on this device."
        : "That hotkey could not be set up on this device (something else may already use it, or your OS doesn't support it) — don't rely on it here. The rest of the app still works normally.",
    ]),
  );

  mount(container, pane);
}
