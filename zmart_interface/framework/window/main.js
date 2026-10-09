/**
 * The operator page, put together.
 *
 * This file composes the page and nothing else. It builds the one object
 * every module shares -- `page` -- and then lets each module put its part on
 * it: the framework's rail, action bar, runner, tabs and channel; and then
 * each workflow's own wiring, through the `install(page)` its flow exports.
 * Nothing here names a workflow, a backend or a panel: the page would compose
 * the same way for a workflow about e-learning or about image analysis.
 *
 * `page` is the page's whole surface, and every module reaches the others
 * through it at call time (`page.renderAll()`, `page.stage`, ...), which is
 * what lets each live in its own file without caring which was wired first.
 * What it carries:
 *
 * - `run`: the run document (`run-state.js`); `WORKFLOWS`, `flow()`,
 *   `steps()`, `step(i)`, `indexOfStep(id)`, `tabsForStep(i)`; `panels`,
 *   one element per panel a workflow declared.
 * - `backend`: the seam to whatever the workflow drives, chosen by the
 *   workflow's own `backendFor` (target acquisition answers the bridge, or
 *   the in-browser rehearsal for `?backend=pretend`); an empty object for a
 *   workflow that drives nothing.
 * - `shown`: the handles of the boxes a workflow's steps put on screen, set
 *   by each step's channel when it mounts; empty until a workflow fills it.
 * - the hook lists, each an array a workflow's `install` pushes to:
 *   `onRender` after every render, `onPanelShown` whenever a panel is drawn,
 *   `onReset` when the run starts over, `onChannelMounted` after a step's
 *   controls were mounted in the channel, and `onThemeChanged` when the
 *   page's theme switches, for the parts that chose their colours themselves.
 * - and the functions the modules lend it, named as they are installed.
 */

import "./style.css";
import { assembleWorkflows } from "../rules/finding-workflows.js";
import { panelsFor } from "../rules/steps.js";
import { installActionBar } from "./action-bar.js";
import { loadInstalledWorkflows } from "./installed-workflows.js";
import { buildThePanels } from "./panels.js";
import { installRail } from "./rail.js";
import { installRunner } from "./runner.js";
import { exposeTheRunForTests, freshRun } from "./run-state.js";
import { installRuntime } from "./runtime.js";
import { installSide } from "./side.js";
import { installTabs } from "./tabs.js";

/* The workflows this page offers: every folder in `workflows/` with a
   `flow.js` inside it, found by the build tool's folder scan and assembled by
   the framework. The unit tests read the same folders, so a workflow the tests
   can see is a workflow the operator can choose. The list used to be written
   out by hand — twice, at one point — and the copies drifted apart in silence,
   which is why it is now read off the disk instead. */
const { WORKFLOWS, DEFAULT_WORKFLOW } = assembleWorkflows(
  import.meta.glob("../../workflows/*/flow.js", { eager: true }),
);

/* What a workflow that drives nothing is handed as its backend: nothing to
   call, and nothing that answers. A workflow's steps that never speak to an
   instrument never reach for it. */
const NO_BACKEND = Object.freeze({});

/* Which workflow to open on — `?workflow=target_acquisition`.
 *
 * For pointing this page at a run and looking at it, which is what somebody
 * with an acquisition in their hand wants and what `serve_a_run.py` prints an
 * address for. Without it that address lands on the first step of the ordinary
 * run and the picture is two clicks away, every time.
 *
 * A name that is not a workflow is ignored rather than refused: the page is
 * still perfectly usable on its ordinary workflow, and an address that opens
 * something slightly unexpected is a smaller failure than one that opens
 * nothing. The first step is then shown as it always is — there is no separate
 * path here, and no `?step=`, because a workflow whose first step is not where
 * you want to start is a workflow that has its steps in the wrong order.
 */
const WORKFLOW_ASKED_FOR = new URLSearchParams(location.search).get("workflow");
const OPENS_ON = WORKFLOWS[WORKFLOW_ASKED_FOR] ? WORKFLOW_ASKED_FOR : DEFAULT_WORKFLOW;

/* The seam, chosen by the workflow: what its steps speak to, and whether a
   rehearsal of it exists. Asked again whenever the workflow changes, with
   the page's own address so a workflow can read `?backend=` off it. */
const backendFor = () =>
  page.flow().backendFor?.(new URLSearchParams(location.search)) ?? NO_BACKEND;

const page = {
  WORKFLOWS, DEFAULT_WORKFLOW, backendFor,
  /* The workflow open now, as assembled: its steps, panels and the rest. */
  flow: () => WORKFLOWS[page.run.wf],
  steps: () => page.flow().steps,
  step: (i) => page.steps()[i],
  indexOfStep: (id) => page.steps().findIndex((s) => s.id === id),
  /* The rule, with the workflow's own staying panels already in it. Bound
     once because it is asked in two places — when a step is walked to, and
     again on every render — and two callers passing the list separately is
     one caller forgetting to. */
  tabsForStep: (i) => panelsFor(page.steps(), i, page.flow().panels.filter((p) => p.stays).map((p) => p.key)),
  shown: {},
  onRender: [],
  onPanelShown: [],
  onReset: [],
  onChannelMounted: [],
  onThemeChanged: [],
};

/* The backend is asked of the workflow being opened, before there is a run to
   read the workflow off, so the first answer is made by hand. */
page.backend = WORKFLOWS[OPENS_ON].backendFor?.(new URLSearchParams(location.search)) ?? NO_BACKEND;
/* The framework's keys of the run, and beside them whatever the workflow
   says a run of it holds; the framework reads none of the latter. */
page.run = freshRun({ workflow: OPENS_ON, backend: page.backend, flow: WORKFLOWS[OPENS_ON] });
page.panels = buildThePanels(WORKFLOWS);

/* The framework: what runs any workflow. */
Object.assign(page, installRail(page));
Object.assign(page, installActionBar(page));
Object.assign(page, installRunner(page));
Object.assign(page, installTabs(page));
Object.assign(page, installSide(page));

/* The workflows: each wires itself to the page once, the first time a run of
   it begins -- as the page opens on it, or when the operator chooses it --
   so that `page.run` is a run of its own when it does. Its panels are built
   and kept from the start, so what it draws on them is wired once too, and
   switching workflows shows a different set rather than rebuilding. A flow
   with no `install` has nothing to wire. The flow is told the folder it is
   installed under, so its hooks can ask whether it is the workflow open. */
const installed = new Set();
page.installWorkflow = (folder) => {
  if (installed.has(folder) || !WORKFLOWS[folder]) return;
  installed.add(folder);
  WORKFLOWS[folder].install?.(page, { folder });
};
page.installWorkflow(OPENS_ON);

/* Left where a test can reach it: the framework's fields, and whatever the
   workflow of the moment exposes of its own. */
exposeTheRunForTests(page.run, page.flow);

/* A change of theme repaints everything that chose its colours itself; the
   workflows say what that is. */
const mo = new MutationObserver(() => {
  for (const repaint of page.onThemeChanged) repaint();
});
mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

/**
 * A workflow arriving after the page opened -- loaded from a package
 * installed on this machine, or handing itself over through
 * `globalThis.zmart.register` -- joins the ones built in: assembled the same
 * way, its panels built beside the others, the chooser drawn again; its
 * `install` runs when it is first chosen. The run that is open is left as it
 * is, unless the page's address asked for this very workflow, which the page
 * then opens on, as it would have had the workflow been built in.
 */
page.registerWorkflow = (folder, flow) => {
  const { WORKFLOWS: assembled } = assembleWorkflows({ [`${folder}/flow.js`]: flow });
  const arrived = assembled[folder];
  if (!arrived || WORKFLOWS[folder]) return null;
  WORKFLOWS[folder] = arrived;
  buildThePanels({ [folder]: arrived }, page.panels);
  page.renderChooser();
  if (WORKFLOW_ASKED_FOR === folder) page.switchWorkflow(folder);
  else page.renderAll();
  return arrived;
};

/* The runtime a loaded bundle imports the framework from, on the window. */
installRuntime({ onRegister: page.registerWorkflow });

/* The page as it opens: on the first step. */
page.focusPanelsFor(0);
page.renderAll();

/* Then whatever is installed on this machine, once the page stands; a page
   held by the development server, with no bridge beside it, finds nothing
   and says nothing. */
loadInstalledWorkflows({ register: page.registerWorkflow, refuse: page.refuseWorkflow });
