import { el, mount } from "../dom.js";

/** Matches vault/destroy.ts's confirmationMatches() exactly — the button stays disabled and visually inert until the typed text matches the exact phrase, no leniency. */
export async function renderDestroyScreen(container: Element, onDone: () => void): Promise<void> {
  const [disclosure, phrase] = await Promise.all([
    window.antistalker.destroy.disclosureText(),
    window.antistalker.destroy.confirmationPhrase(),
  ]);

  let typed = "";
  let result: DestroyResult | undefined;

  function draw(): void {
    const pane = el("div", { class: "content-pane" });
    pane.append(el("h1", {}, ["Remove local app data"]), el("p", {}, [disclosure]));

    if (result?.removed) {
      pane.append(
        el("div", { class: "empty-state" }, [
          `Removed ${result.filesRemoved.length} file${result.filesRemoved.length === 1 ? "" : "s"}. This window can be closed.`,
        ]),
      );
      mount(container, pane);
      return;
    }

    const field = el("div", { class: "field" });
    field.append(
      el("label", { for: "confirm" }, [`Type "${phrase}" to confirm`]),
      (() => {
        const input = el("input", { id: "confirm", type: "text", autocomplete: "off" }) as HTMLInputElement;
        input.value = typed;
        input.addEventListener("input", () => {
          typed = input.value;
          confirmBtn.disabled = typed !== phrase;
        });
        return input;
      })(),
    );
    pane.append(field);

    const confirmBtn = el("button", { type: "button", class: "btn btn--danger" }, ["Remove local app data"]) as HTMLButtonElement;
    confirmBtn.disabled = typed !== phrase;
    confirmBtn.addEventListener("click", async () => {
      result = await window.antistalker.destroy.confirm(typed);
      draw();
      if (result.removed) onDone();
    });
    pane.append(confirmBtn);

    mount(container, pane);
  }

  draw();
}
