import { el, mount } from "../dom.js";

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Authors score/signals.ts's structural-detector input: marked boundaries
 * and tagged phrases (see triage/view.ts, which folds a fired signal into
 * a thread's band). Reached from Settings, not the main app nav — this is
 * setup, not something visited routinely.
 */
export async function renderBoundariesScreen(container: Element): Promise<void> {
  let boundaries = await window.docket.userContext.listBoundaries();
  let taggedPhrases = await window.docket.userContext.listTaggedPhrases();

  async function refresh(): Promise<void> {
    [boundaries, taggedPhrases] = await Promise.all([
      window.docket.userContext.listBoundaries(),
      window.docket.userContext.listTaggedPhrases(),
    ]);
    draw();
  }

  function draw(): void {
    const pane = el("div", { class: "content-pane" });
    pane.append(
      el("h1", {}, ["Boundaries & tagged phrases"]),
      el("p", {}, [
        "Helps triage catch patterns that don't read as toxic on their own — contact after you've asked someone to stop, or a phrase only they would use. Stored in your vault, not shared anywhere.",
      ]),
    );

    // Boundaries
    pane.append(el("h1", { style: "font-size:13px;margin-top:8px;" }, ["Boundaries"]));
    if (boundaries.length === 0) {
      pane.append(el("div", { class: "empty-state" }, ["No boundaries recorded yet."]));
    } else {
      const list = el("div", { class: "list-block" });
      for (const b of boundaries) {
        const row = el("div", { class: "list-block-row", style: "flex-direction:row;align-items:center;justify-content:space-between;" });
        row.append(
          el("div", {}, [
            el("div", { class: "list-block-row-title" }, [b.description]),
            el("div", { class: "list-block-row-sub" }, [
              `Set ${b.setAt.toLocaleDateString()}${b.appliesToSender ? ` · only from ${b.appliesToSender}` : ""}`,
            ]),
          ]),
        );
        const removeBtn = el("button", { type: "button", class: "btn" }, ["Remove"]);
        removeBtn.addEventListener("click", async () => {
          await window.docket.userContext.removeBoundary(b.id);
          await refresh();
        });
        row.append(removeBtn);
        list.append(row);
      }
      pane.append(list);
    }

    const boundaryForm = el("div", { style: "display:flex;flex-direction:column;gap:12px;margin-top:8px;" });
    const descInput = el("input", { type: "text", placeholder: "e.g. told them to stop contacting me" }) as HTMLInputElement;
    const dateInput = el("input", { type: "date" }) as HTMLInputElement;
    dateInput.value = todayInputValue();
    const senderInput = el("input", { type: "text", placeholder: "Only from this sender (optional)" }) as HTMLInputElement;
    const addBoundaryBtn = el("button", { type: "button", class: "btn btn--inline" }, ["Add boundary"]);
    addBoundaryBtn.addEventListener("click", async () => {
      if (descInput.value.trim().length === 0) return;
      const setAt = dateInput.value ? new Date(dateInput.value) : new Date();
      const sender = senderInput.value.trim();
      await window.docket.userContext.addBoundary(descInput.value.trim(), setAt, sender.length > 0 ? sender : undefined);
      descInput.value = "";
      senderInput.value = "";
      await refresh();
    });
    boundaryForm.append(
      el("div", { class: "field" }, [el("label", {}, ["Description"]), descInput]),
      el("div", { class: "field" }, [el("label", {}, ["Date"]), dateInput]),
      el("div", { class: "field" }, [el("label", {}, ["Applies to"]), senderInput]),
      addBoundaryBtn,
    );
    pane.append(boundaryForm);

    // Tagged phrases
    pane.append(el("h1", { style: "font-size:13px;margin-top:24px;" }, ["Tagged phrases"]));
    if (taggedPhrases.length === 0) {
      pane.append(el("div", { class: "empty-state" }, ["No tagged phrases yet."]));
    } else {
      const list = el("div", { class: "list-block" });
      for (const t of taggedPhrases) {
        const row = el("div", { class: "list-block-row", style: "flex-direction:row;align-items:center;justify-content:space-between;" });
        row.append(
          el("div", {}, [
            el("div", { class: "list-block-row-title" }, [t.phrase]),
            el("div", { class: "list-block-row-sub" }, [t.note]),
          ]),
        );
        const removeBtn = el("button", { type: "button", class: "btn" }, ["Remove"]);
        removeBtn.addEventListener("click", async () => {
          await window.docket.userContext.removeTaggedPhrase(t.id);
          await refresh();
        });
        row.append(removeBtn);
        list.append(row);
      }
      pane.append(list);
    }

    const phraseForm = el("div", { style: "display:flex;flex-direction:column;gap:12px;margin-top:8px;" });
    const phraseInput = el("input", { type: "text", placeholder: "A phrase, nickname, or reference" }) as HTMLInputElement;
    const noteInput = el("input", { type: "text", placeholder: "Why it matters" }) as HTMLInputElement;
    const addPhraseBtn = el("button", { type: "button", class: "btn btn--inline" }, ["Add tagged phrase"]);
    addPhraseBtn.addEventListener("click", async () => {
      if (phraseInput.value.trim().length === 0) return;
      await window.docket.userContext.addTaggedPhrase(phraseInput.value.trim(), noteInput.value.trim());
      phraseInput.value = "";
      noteInput.value = "";
      await refresh();
    });
    phraseForm.append(
      el("div", { class: "field" }, [el("label", {}, ["Phrase"]), phraseInput]),
      el("div", { class: "field" }, [el("label", {}, ["Note"]), noteInput]),
      addPhraseBtn,
    );
    pane.append(phraseForm);

    mount(container, pane);
  }

  draw();
}
