/**
 * The step's press, and the sentence beside it.
 *
 * A step's action lives with the panel it operates, at the end of it — the
 * way Connect's button has always sat inside its form. There is no bar above
 * the panel: a button that runs the thing you are looking at should not be
 * somewhere else, and a sentence explaining the step belongs with the step,
 * which is the rail.
 *
 * What the press says and does comes from the step's own declaration, and
 * this only asks it: `btn` is the words on it, `again` what it says once the
 * step has run, `brake` how a running step is stopped, `rerunCurrent` the
 * extra press that takes one item again, `walks` for a step whose press
 * walks the others rather than running through the page, `beside` the
 * sentence next to the press, and `noHint` that nothing stands beside it. The fields are
 * written out in `workflows/README.md`.
 */

import type { FramePage } from "../types.ts";

/** Put the action bar on the page: `renderStepAction(shown)` and `renderActionBar()`. */
export function installActionBar(page: FramePage) {
  const { run: state, panels: thePanels, step } = page;

  function renderStepAction(shown?: string) {
    for (const panel of Object.values(thePanels)) {
      if (panel.foot) panel.foot.textContent = "";
    }
    /* A step's controls that are kept between mounts keep their slot too, so
       it is emptied before the press goes in again. */
    const slot = page.actionSlot();
    if (slot) slot.textContent = "";
    if (!shown) return;
    const i = state.activeIdx, s = step(i);
    /* A step whose controls have a place for its press puts it at the end of
       them (the slot their mount answered); the rest fall back to the foot of
       the panel they are looking at. */
    const host = slot ?? thePanels[shown]?.foot ?? null;
    if (!host) return;
    if (s.ownButton || !s.btn) return;

    const done = state.done.has(s.id);
    const running = state.running === s.id;
    const blocked = page.readiness(s);
    /* The walk's own Interrupt, while a step that walks the others is
       walking them: shown in whichever step's box the walk is standing in,
       latching the walk to end after the step in hand, and stopping that
       step where it has a brake (`page.interruptWalk`). */
    if (state.walk.running) {
      const walker = page.steps().find((one) => one.walks);
      const stop = document.createElement("button");
      stop.className = "run step-run running";
      stop.type = "button";
      stop.textContent = state.walk.interrupted ? "stopping…" : "Interrupt";
      stop.disabled = state.walk.interrupted;
      stop.addEventListener("click", () => page.interruptWalk());
      host.append(stop);
      const hint = document.createElement("span");
      hint.className = "action-hint";
      /* In the walking step's own words (`walks.whileWalking`), or its title. */
      hint.textContent = walker?.walks?.whileWalking ?? (walker ? `running ${walker.title}` : "running the steps");
      host.append(hint);
      return;
    }

    const run = document.createElement("button");
    /* marked as the step's own, because where it sits depends on the step —
       and marked `running` while the step is, because the label is for the
       operator and changes with what pressing it means ("working…",
       "Interrupt", "stopping…"): anything that needs to know whether the
       run is still going reads the class, never the prose. */
    run.className = `run step-run${running ? " running" : ""}`; run.type = "button";
    /* A running step the operator can stop offers its own brake: the press
       that started the run becomes Interrupt, and the backend stops between
       two fields — what was captured stands. The steps that drive the stage
       for minutes are exactly the ones a hand must be able to reach. Each
       brake matches the machinery its run drives, and the step declares it. */
    const ownBrake = s.brake;
    const brake = ownBrake ? () => ownBrake(page) : null;
    /* A step that can take one item again -- the acquisition, its current
       tile -- offers that press before the one that takes everything. */
    const oneAgain = !running && !blocked && state.ran.has(s.id) ? s.rerunCurrent?.(page) : null;
    if (oneAgain) {
      const current = document.createElement("button");
      current.className = "run rerun-current";
      current.type = "button";
      current.textContent = "Rerun current";
      current.addEventListener("click", () => page.runStep(i, oneAgain()));
      host.append(current);
    }
    if (running && brake) {
      run.textContent = state.interrupting === s.id ? "stopping…" : "Interrupt";
      run.disabled = state.interrupting === s.id;
      run.addEventListener("click", () => {
        state.interrupting = s.id;
        brake();
        renderActionBar();
      });
    } else {
      run.textContent = running
        ? "working…"
        : (state.ran.has(s.id) ? (s.again ?? "Run again") : s.btn);
      run.disabled = !!state.running || !!blocked;
      run.addEventListener("click", () => {
        if (!s.walks) return page.runStep(i);
        /* A walk starts clean, as a run of one step clears its own last
           failure: what failed before it is what the walk runs again. */
        state.failed = null;
        return s.walks.press(page);
      });
    }
    host.append(run);
    /* Anything the step puts beside its press once it has run. */
    s.afterThePress?.(host, page);

    /* Some steps say nothing beside their press: what they wait for is the
       box they stand in, and what they came to is below it. */
    const hint = document.createElement("span");
    if (s.noHint) { host.append(hint); return; }
    if (blocked) { hint.className = "action-hint"; hint.textContent = blocked; }
    /* Only when the button itself says Interrupt: a hint repeating the
       button's own "working…" said the same thing twice, side by side. */
    else if (running && brake) { hint.className = "action-hint"; hint.textContent = "working…"; }
    /* What a step came to is said beside the button that produced it, in the
       step's own words when it has them, and as its note otherwise. What is
       missing is another matter: that is why the button cannot be pressed,
       and it belongs beside it. */
    else {
      const said = s.beside ? s.beside(state, { done }) : state.notes[s.id];
      if (said) { hint.className = "action-hint ok"; hint.textContent = said; }
    }
    host.append(hint);
  }

  /* Which panel is showing decides which foot fills, so the action follows the
     operator rather than the step declaring where to put it. */
  const renderActionBar = () => renderStepAction(page.shownPanel());

  return { renderStepAction, renderActionBar };
}
