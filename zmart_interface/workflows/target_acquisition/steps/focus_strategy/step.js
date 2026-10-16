/**
 * Step 4 — Focus strategy.
 *
 * The focus preset is recorded here for the same reason the overview preset is
 * recorded in the scan-area step: the sweeps that measure the surface are
 * taken with it, so the reading lives in the step that uses it.
 *
 * The map itself -- the points, their sweeps and the surface through them --
 * is `focus-map.js`; `channel.js` puts its controls in the channel, and
 * `run.js` measures it.
 */

/* Whether a step has what it needs is asked of the slot itself: a step waits
   for a reading to have been taken, not for a particular field on a record. */
import { hasRecording } from "../../../../parts/microscope/recordings.js";
import { focusChannel } from "./channel.js";
import { focusFinished, runFocus } from "./run.js";

export const focusStrategy = {
  id: "focus",
  title: "Focus strategy",
  why: "Record the focussing preset, then choose how this run keeps every image sharp across the sample.",
  btn: "Run focus map",
  panels: [],
  ms: 0,
  mode: "focus",
  /* Measuring a surface is the optional extra, not the step: either kind of
     focussing is already a complete answer on its own — the stand holds focus,
     or the run finds it at every position. So the only thing this waits for is
     the reading it is taken with.

     Not for three points, though a plane needs three: the fit chooses what the
     geometry buys — one point is a height, a few are a plane, enough are a
     spline — so a map of two is a map of two, measured and reported as such.
     Refusing to run it made the operator argue with the step about arithmetic
     it was doing anyway. */
  ready: ({ focus, focusPreset }) =>
    (!hasRecording(focusPreset) ? "record the focussing preset first"
      : focus.points.length ? null
        : "no points to measure yet"),

  /* Recording the preset finishes the step: both kinds keep every image sharp
     on their own, one by holding focus off the coverslip and the other by
     finding it at every position. Measuring a map is the extra on top, so the
     press that measures it stands in its box from the moment the box is there
     — greyed while there is nothing to measure, and saying so. It used to
     disappear instead, which made clearing the points look like it had broken
     the step. */
  run: runFocus,
  finished: focusFinished,
  brake: (page) => page.backend.stopFocusMeasure?.(),
  /* The focus step says nothing beside its press. What it waits for is the
     box it stands in — points, laid by the row above it — and what it came to
     is the traces below; a greyed button between the two is already the whole
     sentence. */
  noHint: true,
  channel: focusChannel,
};
