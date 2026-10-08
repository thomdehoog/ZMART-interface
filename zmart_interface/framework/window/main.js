/**
 * The operator page, put together.
 *
 * This file composes the page and nothing else. It builds the one object
 * every module shares -- `page` -- and then lets each module put its part on
 * it: the framework's rail, action bar, runner, tabs and channel; the
 * workflow's canvas; and each step's own run and controls, which the steps
 * declare for themselves in their `step.js`.
 *
 * `page` is the page's whole surface, and every module reaches the others
 * through it at call time (`page.renderAll()`, `page.stage`, ...), which is
 * what lets each live in its own file without caring which was wired first.
 * What it carries:
 *
 * - `run`: the run document (`run-state.js`); `WORKFLOWS`, `steps()`,
 *   `step(i)`, `indexOfStep(id)`, `tabsForStep(i)`; `panels`, one element
 *   per panel a workflow declared.
 * - `backend`: the seam to the instrument, `live.js` to the bridge or
 *   `mock.js` for the page's own browser tests (`?backend=pretend`).
 * - `shown`: the handles of the boxes on screen -- the session card, the
 *   scan's progress, the detection card, the gating plot, the selection box,
 *   the gallery -- set by each step's channel when it mounts, null before.
 * - `stageWatch`: the clock reading where the stage is, while a session is
 *   open; `redrawAnchors`, how the carrier's list of marks is redrawn.
 * - `onRender` and `onPanelShown`: what else to do after every render, and
 *   whenever a panel is shown, for the parts that draw on their own.
 * - and the functions the modules lend it, named below as they are installed.
 */

import "./style.css";
import { assembleWorkflows } from "../rules/finding-workflows.js";
import { panelsFor } from "../rules/steps.js";
import { installActionBar } from "./action-bar.js";
import { buildThePanels } from "./panels.js";
import { installRail } from "./rail.js";
import { installRunner } from "./runner.js";
import { exposeTheRunForTests, freshRun } from "./run-state.js";
import { installSide } from "./side.js";
import { installTabs } from "./tabs.js";
/* The seam. Connecting, reading a preset off the instrument, measuring the
   focus map and driving the overview scan all go through the backend and are
   awaited; this window never knows whether a real stage moved. The page
   speaks to the controller through the bridge; which driver the controller
   runs — the mock or a real microscope — is chosen on the Connect step. The
   in-browser rehearsal (timers and a synthetic sample) is reachable only by
   `?backend=pretend`, for this page's own browser tests. */
import { backend as liveBackend } from "../../parts/microscope/live.js";
import { backend as pretendBackend } from "../../parts/microscope/mock.js";
/* The one workflow's own wiring: what it puts on the canvas, and the
   functions its steps lend the page. A second workflow would plug in here
   the same way. */
import { installTargetAcquisition } from "../../workflows/target_acquisition/on-the-page.js";

/* The workflows this page offers: every folder in `workflows/` with a
   `flow.js` inside it, found by the build tool's folder scan and assembled by
   the framework. The unit tests read the same folders, so a workflow the tests
   can see is a workflow the operator can choose. The list used to be written
   out by hand — twice, at one point — and the copies drifted apart in silence,
   which is why it is now read off the disk instead. */
const { WORKFLOWS, DEFAULT_WORKFLOW } = assembleWorkflows(
  import.meta.glob("../../workflows/*/flow.js", { eager: true }),
);

const backendFor = () =>
  (new URLSearchParams(location.search).get("backend") === "pretend" ? pretendBackend : liveBackend);

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

const backend = backendFor();
const state = freshRun({
  workflow: WORKFLOWS[WORKFLOW_ASKED_FOR] ? WORKFLOW_ASKED_FOR : DEFAULT_WORKFLOW,
  backend,
});

/* The keys that stay for the rest of the run once a step has asked for one.
   `panelsFor` is handed these rather than knowing any of them. */
const panelsThatStay = () => WORKFLOWS[state.wf].panels.filter((p) => p.stays).map((p) => p.key);

const page = {
  WORKFLOWS, DEFAULT_WORKFLOW, backendFor, backend,
  run: state,
  panels: buildThePanels(WORKFLOWS),
  steps: () => WORKFLOWS[state.wf].steps,
  step: (i) => page.steps()[i],
  indexOfStep: (id) => page.steps().findIndex((s) => s.id === id),
  /* The rule, with the workflow's own staying panels already in it. Bound
     once because it is asked in two places — when a step is walked to, and
     again on every render — and two callers passing the list separately is
     one caller forgetting to. */
  tabsForStep: (i) => panelsFor(page.steps(), i, panelsThatStay()),
  stageWatch: null,
  redrawAnchors: () => {},
  shown: { session: null, scanProgress: null, detection: null, gating: null, selection: null, gallery: null },
  onRender: [],
  onPanelShown: [],
};

/* The framework: what runs any workflow. */
Object.assign(page, installRail(page));
Object.assign(page, installActionBar(page));
Object.assign(page, installRunner(page));
Object.assign(page, installTabs(page));
Object.assign(page, installSide(page));

/* The workflow: its canvas, and what its steps lend the page. */
installTargetAcquisition(page);

/* Left where a test can reach it. */
exposeTheRunForTests(state);

/* A change of theme repaints everything that chose its colours itself. */
const mo = new MutationObserver(() => {
  page.drawStage(); page.drawTrace();
  page.shown.detection?.redraw(); page.shown.gating?.redraw();
});
mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

/* The instruments, asked for once the backend is known; the card fills in
   when the answer lands. Then the page as it opens: on the first step. */
page.listInstruments();
page.renderPointList();
page.rebuildPlan();
page.focusPanelsFor(0);
page.renderAll();
