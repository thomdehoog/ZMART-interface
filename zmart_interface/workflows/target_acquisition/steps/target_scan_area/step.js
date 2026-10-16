/**
 * Step 8 — Target scan area.
 *
 * The counterpart of the overview's scan area, for the targets. The target
 * acquisition settings stand in their own box. Once one has been imported,
 * Add scan areas appears under it with the four placement controls and the
 * step's press. It draws a systematic uniform random sample of what the gates
 * let through and places the fewest target tiles it can over that sample.
 * The target tiles are the plan; acquiring them is the step after.
 *
 * The box is `selection-panel.js`, wired by `channel.js`; the sampling and
 * the placing are `run.js`.
 */

import { hasRecording } from "../../../../parts/microscope/recordings.js";
import { selectionChannel } from "./channel.js";
import { placingFinished } from "./run.js";

export const targetScanArea = {
  id: "select",
  title: "Target scan area",
  why: "Import the settings the targets are imaged with, then place scan areas over a sample of the gated targets.",
  btn: "Place scan areas",
  panels: [],
  ms: 600,
  mode: "select",
  /* Said for what is missing: no objects on this sample is a different
     answer from objects that no gate lets through. */
  ready: ({ gated, cells, targetType }) => (!hasRecording(targetType) ? "import the target settings first"
    : gated.size ? null
      : cells?.size ? "nothing gated yet" : "detect objects on this sample first"),
  /* No work on the instrument: the placing happens when the rehearsal's
     moment is up. */
  finished: placingFinished,
  /* Beside the press, how many the gates let through until the press has
     placed them; what it came to is then the box's own summary. */
  beside: (run, { done }) => (done ? null : `${run.gated.size} gated`),
  channel: selectionChannel,
};
