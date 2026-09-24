/** Tiny DOM helpers shared by every screen — no framework, matching D9 ("boring by default", no new frontend dependency). */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    node.append(child);
  }
  return node;
}

export function mount(root: Element, node: Node): void {
  root.replaceChildren(node);
}

/** D10: off by default, a settings toggle turns this on for a user whose threat model doesn't require the row-disappearing-is-the-confirmation default. */
export function showToast(message: string): void {
  const toast = el("div", { class: "toast", role: "status" }, [message]);
  document.body.append(toast);
  setTimeout(() => toast.remove(), 2200);
}

/**
 * Electron wraps any error a main-process IPC handler throws as
 * `Error invoking remote method 'channel:name': <original error>` — real
 * plumbing detail nobody trying to connect a data source should have to
 * read. Strips that wrapper (and a leading "TypeError:"/"Error:" from the
 * original error's own toString) down to the message underneath.
 */
export function ipcErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Error invoking remote method '[^']*':\s*/, "").replace(/^(?:[A-Za-z]*Error):\s*/, "");
}

export function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}
