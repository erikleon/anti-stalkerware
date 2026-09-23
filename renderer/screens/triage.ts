import { el, formatRelativeTime, mount, showToast } from "../dom.js";

const BUCKETS: Array<{ bucket: Bucket; label: string }> = [
  { bucket: "needs-review", label: "Needs review" },
  { bucket: "reviewed", label: "Reviewed" },
  { bucket: "all", label: "All" },
];

/**
 * The most load-bearing screen (capability #1 in the plan). Bucket rail ->
 * message list (one row per thread) -> detail pane, per DESIGN.md "Layout".
 * No toast by default for hide/mark-reviewed (D10) — the row disappearing
 * and the count updating is the confirmation, unless the user has turned
 * the toast on in Settings.
 */
export async function renderTriageScreen(container: Element): Promise<void> {
  let bucket: Bucket = "needs-review";
  let rows: TriageRow[] = [];
  let counts: Record<Bucket, number> = { "needs-review": 0, reviewed: 0, all: 0 };
  let selectedThreadId: string | undefined;
  let selectedMessages: WireMessage[] = [];
  const settings = await window.antistalker.settings.get();

  async function refresh(): Promise<void> {
    [rows, counts] = await Promise.all([window.antistalker.triage.listRows(bucket), window.antistalker.triage.counts()]);
    if (selectedThreadId && !rows.some((r) => r.threadId === selectedThreadId)) {
      selectedThreadId = undefined;
      selectedMessages = [];
    }
    draw();
  }

  async function selectThread(threadId: string): Promise<void> {
    selectedThreadId = threadId;
    selectedMessages = await window.antistalker.triage.listMessages(threadId);
    draw();
  }

  async function act(row: TriageRow, kind: "review" | "hide"): Promise<void> {
    if (kind === "review") {
      await window.antistalker.triage.setReviewed(row.latestMessageId, true);
    } else {
      await window.antistalker.triage.setHidden(row.latestMessageId, true);
    }
    if (settings.toastOnTriageAction) {
      showToast(kind === "review" ? "Marked reviewed" : "Hidden from Needs review");
    }
    await refresh();
  }

  function draw(): void {
    const screen = el("div", { class: "screen" });

    // Bucket rail
    const rail = el("nav", { class: "bucket-rail", "aria-label": "Message buckets" });
    for (const { bucket: b, label } of BUCKETS) {
      const isCurrent = b === bucket;
      const item = el(
        "button",
        { type: "button", class: "bucket-item row-transition", ...(isCurrent ? { "aria-current": "true" } : {}) },
        [el("span", {}, [label]), el("span", { class: "count" }, [String(counts[b])])],
      );
      item.addEventListener("click", () => {
        bucket = b;
        void refresh();
      });
      rail.append(item);
    }
    screen.append(rail);

    // Message list
    const list = el("div", { class: "message-list", "aria-label": "Threads" });
    if (rows.length === 0) {
      list.append(
        el("div", { class: "empty-state" }, [
          bucket === "needs-review"
            ? "Nothing needs review right now."
            : bucket === "reviewed"
              ? "Nothing has been marked reviewed yet."
              : "No messages in the vault yet.",
        ]),
      );
    }
    for (const row of rows) {
      const isCurrent = row.threadId === selectedThreadId;
      const rowEl = el(
        "div",
        { class: "message-row row-transition", ...(isCurrent ? { "aria-current": "true" } : {}) },
        [],
      );
      const top = el("div", { class: "message-row-top" }, [
        el("span", { class: "message-row-sender" }, [row.sender]),
        el("span", { class: "message-row-time" }, [formatRelativeTime(row.latestSentAt)]),
      ]);
      const badgeRow = el("div", { style: "display:flex;gap:6px;align-items:center;" });
      if (row.band === "high") badgeRow.append(el("span", { class: "badge badge--high" }, ["High"]));
      if (row.band === "medium") badgeRow.append(el("span", { class: "badge badge--medium" }, ["Medium"]));
      if (row.reviewed) badgeRow.append(el("span", { class: "badge badge--reviewed" }, ["Reviewed"]));
      const preview = el("div", { class: "message-row-preview" }, [row.latestText]);

      const openButton = el("button", { type: "button", style: "all:unset;cursor:pointer;display:contents;" }, [
        top,
        badgeRow,
        preview,
      ]);
      openButton.addEventListener("click", () => void selectThread(row.threadId));
      rowEl.append(openButton);

      if (bucket !== "reviewed" || !row.reviewed) {
        const actions = el("div", { class: "message-row-actions" });
        if (!row.reviewed) {
          const reviewBtn = el("button", { type: "button", class: "row-action" }, ["Mark reviewed"]);
          reviewBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            void act(row, "review");
          });
          actions.append(reviewBtn);
        }
        if (!row.hidden) {
          const hideBtn = el("button", { type: "button", class: "row-action" }, ["Hide"]);
          hideBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            void act(row, "hide");
          });
          actions.append(hideBtn);
        }
        if (actions.childElementCount > 0) rowEl.append(actions);
      }

      list.append(rowEl);
    }
    screen.append(list);

    // Detail pane
    const detail = el("div", { class: "detail-pane", role: "main" });
    if (!selectedThreadId) {
      detail.append(el("div", { class: "empty-state" }, ["Select a thread to see the full conversation."]));
    } else {
      for (const m of selectedMessages) {
        const meta = el("div", { class: "detail-message-meta" }, [
          el("span", {}, [m.fromSelf ? "You" : m.sender]),
          el("span", {}, [m.sentAt.toLocaleString()]),
          ...(m.retractedAt ? [el("span", { style: "color:var(--high-fg);" }, ["retracted by sender"])] : []),
          ...(m.editHistory && m.editHistory.length > 0 ? [el("span", {}, ["edited"])] : []),
        ]);
        detail.append(el("div", { class: "detail-message" }, [meta, el("div", { class: "detail-message-text" }, [m.text])]));
      }
    }
    screen.append(detail);

    mount(container, screen);
  }

  draw();
  await refresh();
}
