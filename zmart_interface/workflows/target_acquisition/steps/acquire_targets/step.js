/**
 * Step 9 — Acquire Targets.
 *
 * The gallery joins the channels: the acquired targets ring on the canvas,
 * and the channel holds their low- and high-resolution image pair
 * (`channel.js` and `gallery.js`). `run.js` drives the acquisition.
 */

import { hasRecording } from "../../../../parts/microscope/recordings.js";
import { acquisitionArrived, galleryChannel } from "./channel.js";
import {
  acquisitionFinished, besideTheAcquisitionPress, rerunCurrentTile, runAcquisition,
} from "./run.js";

export const acquireAndCurate = {
  id: "acquire",
  title: "Acquire Targets",
  why: "Image every planned target tile, then inspect its low- and high-resolution image pair.",
  btn: "Acquire Targets",
  panels: [],
  ms: 2200,
  mode: "targets",
  /* Acquiring needs to know what with: the type is a reading taken off the
     instrument in this step's own channel, the way an optics preset is. */
  ready: ({ targetTiles, targetType, targetFocusOn, targetFocus }) =>
    (!targetTiles?.length ? "add the tiles first"
      : !hasRecording(targetType) ? "record the acquisition type first"
        : targetFocusOn && !hasRecording(targetFocus) ? "import the focussing settings first" : null),
  run: runAcquisition,
  finished: acquisitionFinished,
  /* Acquiring the targets is a scan under the hood, and its brake is the scan's. */
  brake: (page) => page.backend.stopAcquireTargets?.(),
  again: "Rerun all",
  rerunCurrent: rerunCurrentTile,
  beside: besideTheAcquisitionPress,
  arrived: acquisitionArrived,
  channel: galleryChannel,
};
