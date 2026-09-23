import { el, mount } from "../dom.js";

/**
 * Crisis resources — see DESIGN.md "Support and resources". Every number
 * here was checked against its own official page, not assumed from
 * memory. Rendered both from the lock screen (no `back` callback needed
 * there beyond a plain back link) and from inside the unlocked app nav.
 */
export function renderSupportScreen(container: Element, options: { onBack?: () => void } = {}): void {
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

  mount(container, pane);
}
