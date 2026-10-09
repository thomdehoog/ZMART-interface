/**
 * Target acquisition on the page: its canvas, and what its steps lend the
 * page so the other steps and the framework can call them by name.
 *
 * Each step keeps its own functions in its own folder, taking the page as
 * their first argument. This is where they are lent to the page
 * (`page.pictureOf(...)` is `pictureOf(page, ...)`), and where the parts
 * that need wiring once at the start -- the canvas, the focus map, the
 * carrier's keyboard, the protocol's blockers -- are installed, in the
 * order they need one another.
 */

import { installTheCanvas } from "./the-canvas.js";
import * as helpers from "./shared/page-helpers.js";
import {
  chosenInstrument, chosenMicroscope, listInstruments, listProtocols, renderSetup,
  theRestOfTheProtocolAppears,
} from "./steps/connect/channel.js";
import { installCarrier } from "./steps/define_carrier/channel.js";
import { activePreset, rebuildPlan } from "./steps/define_scan_area/channel.js";
import { installFocus } from "./steps/focus_strategy/channel.js";
import { focusFitWord } from "./steps/focus_strategy/run.js";
import { testTilesChanged } from "./steps/scan_the_overview/channel.js";
import { overviewGoesGreyForTheMasks } from "./steps/discover_targets/channel.js";
import { selectTarget, targetAt, targetPressed } from "./steps/acquire_targets/channel.js";
import { renderProtocolProgress } from "./steps/run_protocol/channel.js";
import { installProtocol, interruptProtocol, protocolWithin } from "./steps/run_protocol/run.js";

/** Lend functions that take the page first to the page, under their own names. */
function lend(page, functions) {
  for (const [name, fn] of Object.entries(functions)) page[name] = (...a) => fn(page, ...a);
}

export function installTargetAcquisition(page, { folder } = {}) {
  /* Whether this workflow is the one open. The hook lists below are called
     for every workflow's run -- a reset puts down what every workflow holds
     -- but what reads this workflow's own keys of the run, or asks its
     backend, must only run while the run is this workflow's. */
  const isOpen = () => page.run.wf === folder;
  /* What several steps share on the page. */
  lend(page, {
    pictureOf: helpers.pictureOf, redrawSoon: helpers.redrawSoon,
    recordingOptions: helpers.recordingOptions,
    scannedPlan: helpers.scannedPlan, tilesetOfField: helpers.tilesetOfField,
  });
  /* The steps' own functions, by the names the rest of the page calls. */
  lend(page, {
    chosenInstrument, chosenMicroscope, listInstruments, listProtocols, renderSetup,
    theRestOfTheProtocolAppears,
    activePreset, rebuildPlan,
    testTilesChanged,
    overviewGoesGreyForTheMasks,
    selectTarget, targetAt, targetPressed,
    protocolWithin, interruptProtocol, renderProtocolProgress,
  });
  page.focusFitWord = focusFitWord;
  /* The clock reading where the stage is while a session is open, set by
     Connect and stopped when the run starts over. */
  page.stageWatch = null;
  /* The canvas first: the focus map draws on it. */
  Object.assign(page, installTheCanvas(page, { isOpen }));
  Object.assign(page, installFocus(page));
  Object.assign(page, installCarrier(page));
  Object.assign(page, installProtocol(page));

  /* What this workflow does when the run starts over -- on Disconnect, or
     when another workflow is chosen: the stage's clock is stopped and the
     picture will fit itself to the next session's travel, whichever
     workflow is being opened; and when it is this one, the instruments are
     asked for again (the fresh run has none) and the boxes that draw their
     own picture are drawn empty. */
  page.onReset.push(() => {
    page.stageWatch?.stop();
    page.stageWatch = null;
    page.view.fitted = false;
    if (!isOpen()) return;
    page.shown.gating?.redraw();
    page.renderPointList();
    page.listInstruments();
  });
  /* The protocol's progress stands over whichever step's controls the walk
     is standing in, so it is put there whenever a step's controls go in. */
  page.onChannelMounted.push(() => { if (isOpen()) page.renderProtocolProgress(); });
  /* A change of theme repaints everything here that chose its colours
     itself: the stage, the trace, the detection card and the gating plot. */
  page.onThemeChanged.push(() => {
    if (!isOpen()) return;
    page.drawStage(); page.drawTrace();
    page.shown.detection?.redraw(); page.shown.gating?.redraw();
  });

  /* The instruments, asked for once the backend is known; the card fills in
     when the answer lands. The focus list and the plan drawn once, empty. */
  page.listInstruments();
  page.renderPointList();
  page.rebuildPlan();
}
