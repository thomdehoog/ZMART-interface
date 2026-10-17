/**
 * The target-acquisition run: its steps, in order.
 *
 * This folder is the code home — the steps in their numbered folders, the
 * shared canvas and geometry, the microscope seam — and this file is the run
 * they compose into; `flow.js` beside it is the workflow's front door. What
 * the run drives — the controller's mock driver or the Leica — is chosen on
 * the Connect step, so there is one workflow and one list of steps.
 */

import { connect } from "./steps/connect/step.js";
import { carrierConfiguration } from "./steps/define_carrier/step.js";
import { initialScanfields } from "./steps/define_scan_area/step.js";
import { focusStrategy } from "./steps/focus_strategy/step.js";
import { scanOverview } from "./steps/scan_the_overview/step.js";
import { detectCells } from "./steps/discover_targets/step.js";
import { selectCells } from "./steps/refine_targets/step.js";
import { targetScanArea } from "./steps/target_scan_area/step.js";
import { acquireAndCurate } from "./steps/acquire_targets/step.js";
import { runProtocolStep } from "./steps/run_protocol/step.js";

export const steps = [
  connect,
  carrierConfiguration,
  initialScanfields,
  focusStrategy,
  scanOverview,
  detectCells,
  selectCells,
  targetScanArea,
  acquireAndCurate,
  runProtocolStep,
];
