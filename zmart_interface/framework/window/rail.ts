/**
 * The left rail: the steps in order, and the rules about reaching and
 * editing them. The workflow chooser over it is the composition's
 * (`pages.ts`), since it is one for every workflow.
 *
 * The rail is navigation. It shows each step's number and title, green once
 * done, orange when done under settings that have since changed, and locked
 * until everything before it is done. What a step produced is on the canvas
 * and beside its press, never here.
 *
 * The rules themselves -- which step is reachable, what goes stale when a
 * step is edited -- live in `../rules/steps.ts`, and this only asks them.
 */

import { blockedBecause, editedAt, isReachable } from "../rules/steps.ts";
import { el } from "./dom.ts";
import { startOver } from "./run-state.ts";
import type { FramePage, FrameStep } from "../types.ts";

/**
 * Put the rail on the page. Answers the functions the rest of the page calls:
 * `renderRail`, `readiness`, `stateEdited` and `resetRun`.
 */
export function installRail(page: FramePage) {
  const { run: state, panels: thePanels, steps, step } = page;

  /**
   * Put the run back to its first step, keeping only what outlives a session.
   *
   * What the workflow has to put down when the run starts over -- a clock
   * reading the stage, a picture's fit, a list to ask for again -- is its
   * own, said in its `onReset` hook, called once the run document is fresh.
   */
  function resetRun() {
    /* Every panel's channel is emptied, not only the one about to be shown:
       a hidden form is still a form. */
    for (const panel of Object.values(thePanels)) {
      if (panel.channel) panel.channel.textContent = "";
      if (panel.foot) panel.foot.textContent = "";
    }
    startOver(state, page.backend, page.flow());
    page.focusPanelsFor(0);
    page.hooks.onReset?.();
    page.renderAll();
  }

  function renderRail() {
    const host = el("steps");
    if (!host) return;
    host.textContent = "";

    steps().forEach((s, i) => {
      const done = state.done.has(s.id);
      const stale = done && state.stale.has(s.id);
      const active = i === state.activeIdx;
      /* A step is running while the page runs it -- or, for a step that
         walks the others, while the walk goes. */
      const running = state.running === s.id || (Boolean(s.walks) && state.walk.running);
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
      const named = head.querySelector(".step-name");
      if (named) named.textContent = s.title;
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
        if (state.running || state.walk.running || !reachable) return;
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
     under `workflows/` — and this only asks it, with the run and the page,
     which is why adding a workflow never means adding a condition here. */
  const readiness = (s: FrameStep) => blockedBecause(s, state, page);

  /**
   * The operator edited a step: its settings, or its result by running it
   * again. It is green -- just settled -- and every done step after it is
   * orange, made under what this step was before. The one hook every edit
   * goes through; navigation never calls it, and neither does a step run
   * by the protocol, whose whole point is to make everything afresh.
   */
  function stateEdited(id: string) {
    if (state.walk.running) return;
    state.stale = editedAt(steps(), state.done, state.stale, id);
    /* A step that walks the others has no settings to confirm: an edit
       above it means it has not run on what stands now, which is what its
       press is for. So it is neither orange nor done, whichever step it is;
       the step says it is such a step with `walks`. */
    for (const s of steps().filter((one) => one.walks)) {
      state.stale.delete(s.id);
      state.done.delete(s.id);
    }
    renderRail(); page.renderActionBar();
  }

  return { renderRail, readiness, stateEdited, resetRun };
}
