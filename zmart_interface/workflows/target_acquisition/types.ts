/**
 * Target acquisition's types: its run, its page and its steps, as the
 * workflow API's own types filled in for this workflow.
 *
 * The API's `Page`, `Run` and `Step` take one bag of types (`WorkflowTypes`)
 * and speak of whichever workflow fills it. This file fills it for target
 * acquisition: the run is the framework's keys and `freshState`'s
 * (`shared/run-document.ts`), the backend is the one list of verbs
 * (`backend/verbs.ts`), and the page carries what `on-the-page.js` lends
 * it. Each is read off the code that makes it, so a key added to the fresh
 * run or a function added to the lends is typed where it is written.
 *
 * Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
 * University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
 */

import type { Page, Run, WorkflowTypes } from "../../api/index.ts";
import type { Backend } from "./backend/verbs.ts";
import type { freshState } from "./shared/run-document.ts";
import type { StageWatch } from "./shared/stage-position.ts";
import type { ProgressBox } from "./shared/progress.ts";
import type * as helpers from "./shared/page-helpers.ts";
import type { installTheCanvas } from "./the-canvas.js";
import type * as connect from "./steps/connect/channel.js";
import type { installCarrier } from "./steps/define_carrier/channel.js";
import type * as scanArea from "./steps/define_scan_area/channel.js";
import type { installFocus } from "./steps/focus_strategy/channel.js";
import type { focusFitWord } from "./steps/focus_strategy/run.js";
import type { testTilesChanged } from "./steps/scan_the_overview/channel.js";
import type { overviewGoesGreyForTheMasks } from "./steps/discover_targets/channel.js";
import type * as acquire from "./steps/acquire_targets/channel.js";
import type { renderProtocolProgress } from "./steps/run_protocol/channel.js";
import type { protocolWithin } from "./steps/run_protocol/run.js";
import type galleryWidget from "./steps/acquire_targets/gallery.js";
import type { renderSessionCard } from "./steps/connect/session-card.js";
import type scanfieldsWidget from "./steps/define_scan_area/scanfield-editor.js";
import type detectionPanel from "./steps/discover_targets/detection.js";
import type gatingPanel from "./steps/refine_targets/gate.js";
import type { selectionPanel } from "./steps/target_scan_area/selection-panel.js";

/** A function that takes the page first, as the page lends it: the page already given. */
type Lent<F> = F extends (page: never, ...rest: infer A) => infer R ? (...rest: A) => R : never;

/** What target acquisition lends its page, by the names its steps call (`on-the-page.js`). */
export type Lends = {
  pictureOf: Lent<typeof helpers.pictureOf>;
  redrawSoon: Lent<typeof helpers.redrawSoon>;
  recordingOptions: Lent<typeof helpers.recordingOptions>;
  scannedPlan: Lent<typeof helpers.scannedPlan>;
  tilesetOfField: Lent<typeof helpers.tilesetOfField>;
  chosenInstrument: Lent<typeof connect.chosenInstrument>;
  chosenMicroscope: Lent<typeof connect.chosenMicroscope>;
  listInstruments: Lent<typeof connect.listInstruments>;
  listProtocols: Lent<typeof connect.listProtocols>;
  renderSetup: Lent<typeof connect.renderSetup>;
  theRestOfTheProtocolAppears: Lent<typeof connect.theRestOfTheProtocolAppears>;
  activePreset: Lent<typeof scanArea.activePreset>;
  rebuildPlan: Lent<typeof scanArea.rebuildPlan>;
  testTilesChanged: Lent<typeof testTilesChanged>;
  overviewGoesGreyForTheMasks: Lent<typeof overviewGoesGreyForTheMasks>;
  selectTarget: Lent<typeof acquire.selectTarget>;
  targetAt: Lent<typeof acquire.targetAt>;
  targetPressed: Lent<typeof acquire.targetPressed>;
  protocolWithin: Lent<typeof protocolWithin>;
  renderProtocolProgress: Lent<typeof renderProtocolProgress>;
  focusFitWord: typeof focusFitWord;
  /** The clock reading where the stage is while a session is open. */
  stageWatch: StageWatch | null;
} & ReturnType<typeof installTheCanvas> & ReturnType<typeof installFocus> & ReturnType<typeof installCarrier>;

/** The boxes this workflow's steps put on screen, while they are mounted. */
export interface Shown {
  session?: ReturnType<typeof renderSessionCard> | null;
  editor?: ReturnType<typeof scanfieldsWidget.render> | null;
  detection?: ReturnType<typeof detectionPanel.mount> | null;
  gating?: ReturnType<typeof gatingPanel.mount> | null;
  selection?: ReturnType<typeof selectionPanel.mount> | null;
  gallery?: ReturnType<typeof galleryWidget.mount> | null;
  scanProgress?: ProgressBox | null;
  playBurst?: (() => boolean) | null;
}

/** Target acquisition, as the workflow API's types take it. */
export interface TargetAcquisition extends WorkflowTypes {
  state: ReturnType<typeof freshState>;
  backend: Backend;
  lends: Lends;
  shown: Shown;
  step: Record<never, never>;
}

/** This workflow's page, as each of its steps is handed it. */
export type TaPage = Page<TargetAcquisition>;

/** This workflow's run document: the framework's keys and its own. */
export type TaRun = Run<TargetAcquisition>;

/* What the page leaves on `window`: a test's way of asking a box what it
   shows. One of them is read by the page itself as well -- the canvas's
   display settings, which the previews are drawn with. */
declare global {
  interface Window {
    /** The canvas's display panel, while one is mounted. */
    __viewerPanel?: { snapshot?: () => unknown } | null;
  }
}
