import { el, mount } from "../dom.js";

/**
 * Locked state lists every vault sender with their gate eligibility, and
 * states plainly this is friction against casual misuse, not verification
 * (D22's own language). Selecting an eligible sender moves to the
 * "unlocked" view for that sender — which today always shows an honest
 * empty state, because no live OSINT signal-gathering collector exists
 * (deliberately deferred; see the plan and TODOS.md). Faking ranked leads
 * here would be worse than showing nothing.
 */
export async function renderOsintScreen(container: Element): Promise<void> {
  let unlockedFor: string | undefined;
  let leads: RankedLead[] = [];

  const eligibility = await window.antistalker.osint.eligibleSenders();

  async function unlock(sender: string): Promise<void> {
    leads = await window.antistalker.osint.rank(sender);
    unlockedFor = sender;
    draw();
  }

  function draw(): void {
    const pane = el("div", { class: "content-pane" });

    if (!unlockedFor) {
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
    } else {
      const header = el("div", { style: "display:flex;align-items:center;justify-content:space-between;" });
      header.append(
        el("h1", { style: "margin:0;" }, [`Leads for ${unlockedFor}`]),
        el("span", { class: "traffic-indicator" }, [el("span", { class: "dot", "aria-hidden": "true" }), "generates internet traffic"]),
      );
      pane.append(header);
      pane.append(
        el("p", {}, [
          "Results are unverified leads, never a confirmed identity, and are structurally barred from any evidence export.",
        ]),
      );

      if (leads.length === 0) {
        pane.append(
          el("div", { class: "empty-state" }, [
            "No signal collectors are configured yet, so there's nothing to show. This will list ranked, sourced leads once that's built.",
          ]),
        );
      } else {
        const list = el("div", { class: "list-block" });
        for (const lead of leads) {
          list.append(
            el("div", { class: "list-block-row" }, [
              el("div", { class: "list-block-row-title" }, [lead.candidateId]),
              el("div", { class: "list-block-row-sub" }, [
                `Confidence ${(lead.score * 100).toFixed(0)}% · ${lead.supportingSignalCount} supporting signal${lead.supportingSignalCount === 1 ? "" : "s"}`,
              ]),
            ]),
          );
        }
        pane.append(list);
      }

      const back = el("a", { href: "#", style: "font-size:12px;color:var(--text-dim);" }, ["← Back to senders"]);
      back.addEventListener("click", (e) => {
        e.preventDefault();
        unlockedFor = undefined;
        draw();
      });
      pane.append(back);
    }

    mount(container, pane);
  }

  draw();
}
