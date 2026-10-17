/**
 * The page, composed: one frame, and one page per workflow over it.
 *
 * The frame is what runs any workflow -- the rail and its chooser, the
 * runner, the tabs, the channel and the action bar -- and there is one of
 * each on screen. Each workflow gets a page of its own built over the frame:
 * its steps, its own panels, the backend it speaks to, the boxes its steps
 * put on screen (`shown`), what it lends the page and its hooks. A workflow
 * reaches only its own page, so what one workflow lends is never found on
 * another's, and only the open workflow's hooks run; the one being left is
 * told (`onLeave`).
 *
 * The run document is one object, shared by every page and swapped with the
 * workflow: choosing another workflow starts the run over in place
 * (`run-state.js`).
 *
 * A workflow's page is built the first time the workflow is opened, once the
 * run is a run of it, and then kept: switching back shows its panels again
 * rather than building them anew.
 */

import { panelsFor } from "../rules/steps.js";
import { installActionBar } from "./action-bar.js";
import { el } from "./dom.js";
import { buildThePanels } from "./panels.js";
import { installRail } from "./rail.js";
import { installRunner } from "./runner.js";
import { freshRun, startOver } from "./run-state.js";
import { installSide } from "./side.js";
import { installTabs } from "./tabs.js";

/* What a workflow that drives nothing is handed as its backend: nothing to
   call, and nothing that answers. */
const NO_BACKEND = Object.freeze({});

/**
 * Compose the pages for `WORKFLOWS`, opening on `opensOn`; `search` is the
 * page's own address's query, which a workflow reads its backend off.
 * Answers `open()`, `switchWorkflow(key)`, `pageFor(key)` and `run`.
 */
export function composeThePages({ WORKFLOWS, opensOn, search }) {
  const backendOf = (key) => WORKFLOWS[key].backendFor?.(search) ?? NO_BACKEND;
  const run = freshRun({ workflow: opensOn, backend: backendOf(opensOn), flow: WORKFLOWS[opensOn] });
  const pages = {};

  /** The workflow's page, built and wired the first time it is asked for. */
  function pageFor(key) {
    if (pages[key]) return pages[key];
    const flow = WORKFLOWS[key];
    const page = {
      run,
      backend: backendOf(key),
      flow: () => flow,
      steps: () => flow.steps,
      step: (i) => flow.steps[i],
      indexOfStep: (id) => flow.steps.findIndex((s) => s.id === id),
      /* The rule, with the workflow's own staying panels already in it. */
      tabsForStep: (i) => panelsFor(flow.steps, i, flow.panels.filter((p) => p.stays).map((p) => p.key)),
      panels: buildThePanels(flow),
      shown: {},
      hooks: {},
    };
    pages[key] = page;
    Object.assign(page, installRail(page));
    Object.assign(page, installActionBar(page));
    Object.assign(page, installRunner(page));
    Object.assign(page, installTabs(page));
    Object.assign(page, installSide(page));
    const { lends = {}, hooks = {} } = flow.install?.(page) ?? {};
    Object.assign(page, lends);
    page.hooks = hooks;
    return page;
  }

  /* The chooser: one entry per workflow, each with its own sentence about
     itself shown when the pointer rests on it -- a name has to be short
     enough for the rail, which is not always long enough to say what a
     workflow is for. */
  const chooser = el("wf-select");
  for (const [key, wf] of Object.entries(WORKFLOWS)) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = wf.name;
    option.title = wf.blurb ?? "";
    chooser.append(option);
  }
  chooser.value = run.wf;

  /**
   * Choosing a workflow is choosing to begin it: the workflow being left is
   * told and its panels put away, the run starts over as a run of the one
   * chosen, and that one's page opens on its first step. There is no
   * Restart button -- Disconnect ends a run, and picking a workflow starts
   * one.
   */
  function switchWorkflow(key) {
    const leaving = pages[run.wf];
    if (leaving) {
      leaving.hooks.onLeave?.();
      /* Hidden, and emptied: a hidden form is still a form -- a second
         password field the page can find. */
      for (const panel of Object.values(leaving.panels)) {
        panel.host.classList.remove("on");
        if (panel.channel) panel.channel.textContent = "";
        if (panel.foot) panel.foot.textContent = "";
      }
    }
    run.wf = key;
    chooser.value = key;
    startOver(run, backendOf(key), WORKFLOWS[key]);
    const page = pageFor(key);
    page.focusPanelsFor(0);
    page.hooks.onReset?.();
    page.renderAll();
  }
  chooser.addEventListener("change", () => switchWorkflow(chooser.value));

  return {
    run,
    pageFor,
    switchWorkflow,
    /** Open the page as it first appears: the workflow's first step. */
    open() {
      const page = pageFor(run.wf);
      page.focusPanelsFor(0);
      page.renderAll();
      return page;
    },
  };
}
