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
 * extra press that takes one item again, `pressed` what a press does when
 * the step does not run through the page at all, `beside` the sentence next
 * to the press, and `noHint` that nothing stands beside it. The fields are
 * written out in `workflows/README.md`.
 */

import { el } from "./dom.js";

/** Put the action bar on the page: `renderStepAction(shown)` and `renderActionBar()`. */
export function installActionBar(page) {
  const { run: state, panels: thePanels, step } = page;

  function renderStepAction(shown) {
    for (const panel of Object.values(thePanels)) {
      if (panel.foot) panel.foot.textContent = "";
    }
    /* Every step's own slot is emptied, whichever step is standing: a press
       left in a hidden step's box is a press that can still be found. */
    for (const slot of document.querySelectorAll("[class*='-action']")) {
      slot.textContent = "";
    }
    if (!shown) return;
    const i = state.activeIdx, s = step(i);
    /* A step with controls of its own puts its action at the end of them; the
       rest fall back to the bar under the panel they are looking at. */
    const host = document.querySelector(`.${s.id}-action`) ?? el(`foot-${shown}`);
    if (!host) return;
    if (s.ownButton || !s.btn) return;
    /* Some steps have nothing to run under the state they are in — a focus
       step is finished by the recording itself until a map is made to measure.
       A step says so for itself; the framework only asks. */
    if (s.acts && !s.acts(state)) return;

    const done = state.done.has(s.id);
    const running = state.running === s.id;
    const blocked = page.readiness(s);
    /* The walk's own Interrupt, while a step that runs the others is
       walking them: shown in whichever step's box the walk is standing in,
       latching the walk to end after the step in hand, and stopping that
       step where it has a brake. How the walk is stopped is the walking
       step's own `brake`; the framework only finds that step. */
    if (state.protocol.running) {
      const walker = page.steps().find((one) => one.runsTheOthers);
      const stop = document.createElement("button");
      stop.className = "run step-run running";
      stop.type = "button";
      stop.textContent = state.protocol.interrupted ? "stopping…" : "Interrupt";
      stop.disabled = state.protocol.interrupted;
      stop.addEventListener("click", () => walker?.brake?.(page));
      host.append(stop);
      const hint = document.createElement("span");
      hint.className = "action-hint";
      /* In the walking step's own words (`whileWalking`), or its title. */
      hint.textContent = walker?.whileWalking ?? (walker ? `running ${walker.title}` : "running the steps");
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
    const brake = s.brake ? () => s.brake(page) : null;
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
      run.addEventListener("click", () => (s.pressed ? s.pressed(page) : page.runStep(i)));
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
