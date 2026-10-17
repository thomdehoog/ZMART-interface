/**
 * The workflow API: what a workflow may use of the interface, and what it
 * declares for the interface to run it.
 *
 * A workflow imports its own files, this module, and the npm packages the
 * interface lists; nothing else (dependency-cruiser stops the build on
 * anything else). Every name here is part of the agreement, and so is when
 * the framework calls what a workflow declares (`docs/the-workflow-api.md`).
 * A change to either is a change of `API_VERSION`, which each workflow's
 * `workflow.json` names a range of.
 *
 * Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
 * University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
 */

import version from "./version.json";

/** The version of this agreement (`version.json`). At 0.x every minor is a change a workflow must look at. */
export const API_VERSION: string = version.version;

/* ---- the helpers a step reaches for ----------------------------------------- */

export { el, css, sizeCanvas } from "../framework/window/dom.ts";
export { sideGroup } from "../framework/window/panels.ts";
export { status } from "../framework/window/status.ts";
export { atBridge } from "../framework/window/bridge-address.ts";
export { editedAt, staleSteps } from "../framework/rules/steps.ts";

/** The page's base colours and measures, as CSS custom properties a workflow's styles and canvases read. */
export type ThemeVar =
  | "--bg" | "--screen" | "--surface-2" | "--surface-3" | "--control" | "--box-gap"
  | "--line" | "--line-strong" | "--ink" | "--ink-2" | "--ink-3"
  | "--accent" | "--accent-deep" | "--accent-tint" | "--accent-line"
  | "--good" | "--bad" | "--warn-bg" | "--warn-ink" | "--confirm-ink" | "--edit-ink" | "--warn-line"
  | "--shadow" | "--mono" | "--sans" | "--side-w" | "--head-h" | "--brand";

/* ---- the types a workflow fills in, written beside the framework ------------- */

export type {
  WorkflowTypes,
  Plain,
  Walk,
  FrameworkRun,
  Run,
  RunAnswer,
  Outcome,
  Mounted,
  Channel,
  Built,
  Panel,
  BuiltPanel,
  Walks,
  Step,
  Page,
  Hooks,
  Installed,
  Flow,
} from "../framework/types.ts";
