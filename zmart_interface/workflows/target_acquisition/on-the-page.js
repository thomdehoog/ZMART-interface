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

export function installTargetAcquisition(page) {
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
  /* The canvas first: the focus map draws on it. */
  Object.assign(page, installTheCanvas(page));
  Object.assign(page, installFocus(page));
  Object.assign(page, installCarrier(page));
  Object.assign(page, installProtocol(page));
}
