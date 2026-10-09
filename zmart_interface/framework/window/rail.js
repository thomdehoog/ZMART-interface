/**
 * The left rail: the workflow chooser, the steps in order, and the rules
 * about reaching and editing them.
 *
 * The rail is navigation. It shows each step's number and title, green once
 * done, orange when done under settings that have since changed, and locked
 * until everything before it is done. What a step produced is on the canvas
 * and beside its press, never here.
 *
 * The rules themselves -- which step is reachable, what goes stale when a
 * step is edited -- live in `../rules/steps.js`, and this only asks them.
 */

import { blockedBecause, editedAt, isReachable, staleSteps } from "../rules/steps.js";
import { el } from "./dom.js";
import { startOver } from "./run-state.js";

/**
 * Put the rail on the page. Answers the functions the rest of the page calls:
 * `renderRail`, `readiness`, `stateEdited`, `resetRun` and `switchWorkflow`.
 */
export function installRail(page) {
  const { run: state, panels: thePanels, steps, step, WORKFLOWS, backendFor } = page;

  const selectEl = el("wf-select");
  for (const [key, wf] of Object.entries(WORKFLOWS)) {
    const opt = document.createElement("option");
    opt.value = key; opt.textContent = wf.name;
    /* Each workflow's own sentence about itself, shown when the pointer rests on
       it. A name has to be short enough for the rail, which is not always long
       enough to say what a workflow is for — and it matters most for the one
       that is a demonstration rather than a run, because somebody choosing it by
       mistake should be able to find that out before they choose it. */
    opt.title = wf.blurb;
    selectEl.append(opt);
  }
  selectEl.value = state.wf;

  /* Choosing a workflow is choosing to begin it: the switch restarts the run.
     There is no Restart button — the session card's Disconnect ends a run,
     and picking a workflow starts one. */
  function switchWorkflow(key) {
    state.wf = key;
    selectEl.value = key;
    page.backend = backendFor();
    resetRun();
    page.listInstruments();
  }
  selectEl.addEventListener("change", () => switchWorkflow(selectEl.value));

  /** Put the run back to its first step, keeping only what outlives a session. */
  function resetRun() {
    page.stageWatch?.stop();
    page.stageWatch = null;
    /* Every panel's channel is emptied, not only the one about to be shown:
       switching workflows leaves the other workflow's panel hidden with its
       last step's controls still in it, and a hidden form is still a form
       -- a second password field the page can find. */
    for (const panel of Object.values(thePanels)) {
      if (panel.channel) panel.channel.textContent = "";
      if (panel.foot) panel.foot.textContent = "";
    }
    startOver(state, backendFor(), WORKFLOWS[state.wf]);
    page.view.fitted = false;
    page.focusPanelsFor(0);
    page.shown.gating?.redraw();
    page.renderPointList();
    page.renderAll();
  }

  function renderRail() {
    const host = el("steps");
    host.textContent = "";

    steps().forEach((s, i) => {
      const done = state.done.has(s.id);
      const stale = done && state.stale.has(s.id);
      const active = i === state.activeIdx;
      /* A step is running while the page runs it -- or, for a step that
         runs the others, while it says so itself. */
      const running = state.running === s.id || Boolean(s.running?.(state));
      const reachable = isReachable(steps(), state.done, i);

      const b = document.createElement("button");
      b.className = "step" + (active ? " active" : "") + (done ? " done" : "")
        + (stale ? " stale" : "") + (reachable ? "" : " locked");
      b.type = "button";
      if (!reachable) b.disabled = true;

      const head = document.createElement("div");
      head.className = "step-head";
      head.innerHTML =
        `<span class="step-n">${s.n}</span><span class="step-name"></span>`;
      head.querySelector(".step-name").textContent = s.title;
      if (running) head.insertAdjacentHTML("beforeend", '<span class="spin"></span>');
      /* An orange step says what it asks for, at its right: a look. A word,
         not a press -- confirming is one press for all of them, in Step 10
         (Thom, 2026-09-28). */
      if (stale) head.insertAdjacentHTML("beforeend", '<span class="review-tag">review</span>');
      b.append(head);
      /* Number and title, nothing else: the rail is navigation, the green
         badge already says done, and what a step produced is on the canvas
         and in the action bar. A note under every finished step read as a
         second, worse copy of the run. */

      b.addEventListener("click", () => {
        if (state.running || state.protocol.running || !reachable) return;
        state.activeIdx = i;
        /* Some steps are settled by being stood on -- the carrier by being
           configured, the scan fields by being drawn, the gates by being
           looked at -- and the step says so for itself. */
        step(i).settledByStanding?.(page);
        page.focusPanelsFor(i);
        page.renderAll();
      });

      host.append(b);
    });
  }

  /* What this step still needs before it may run, and what to say when it is
     not met. The step itself holds the rule — see the step's own `step.js` file
     under `workflows/` — and this only asks it, which is why adding a workflow
     never means adding a condition here. The server would enforce the same list. */
  const readiness = (s) => blockedBecause(s, state);

  /* The steps standing orange, in rail order, for the step that asks: Run
     protocol waits on every one of them. Kept on the state so a step's own
     `ready` rule can read it without knowing the list of steps. */
  state.staleSteps = () => staleSteps(steps(), state.done, state.stale);

  /**
   * The operator edited a step: its settings, or its result by running it
   * again. It is green -- just settled -- and every done step after it is
   * orange, made under what this step was before. The one hook every edit
   * goes through; navigation never calls it, and neither does a step run
   * by the protocol, whose whole point is to make everything afresh.
   */
  function stateEdited(id) {
    if (state.protocol.running) return;
    state.stale = editedAt(steps(), state.done, state.stale, id);
    /* Step 10 has no settings to confirm: an edit above it means it has
       not run on what stands now, which is what its press is for. */
    state.stale.delete("protocol");
    state.done.delete("protocol");
    renderRail(); page.renderActionBar();
  }

  return { renderRail, readiness, stateEdited, resetRun, switchWorkflow };
}
