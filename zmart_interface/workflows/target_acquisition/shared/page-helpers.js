/**
 * What several steps of this workflow share on the page: where a capture's
 * picture is fetched from, one redraw per frame, the recording slots' wiring,
 * and the plan as it was scanned.
 *
 * Every function takes the page first, the way a step's own run does, and
 * the page lends them out under their own names (`page.pictureOf`, ...) so
 * a step calls them without knowing where they live.
 */

import { displayedPictureAddress } from "../../../parts/canvas/display-of.js";
import { activeRecording } from "../../../parts/microscope/recordings.js";

/** Where a capture's picture is: the viewer's small copy, by the capture's
    label -- drawn with the canvas's own display settings for that
    acquisition when there are any, so the preview and the gallery show the
    sample the way the picture shows it. */
export const pictureOf = (
  page, kind, label, { displayAs = kind, requireDisplay = false } = {},
) => {
  const where = page.backend.viewOf(kind);
  const snapshot = window.__viewerPanel?.snapshot?.() ?? null;
  return displayedPictureAddress(where, label, snapshot, displayAs, { requireDisplay });
};

/* Targets arrive far faster than a picture can be drawn. One redraw per
   frame, however many fields landed in it. */
let redrawPending = false;
export function redrawSoon(page) {
  if (redrawPending) return;
  redrawPending = true;
  requestAnimationFrame(() => { redrawPending = false; page.drawStage(); page.renderAll(); });
}

/* One slot per step, and the rows in it are the recordings.
 *
 * The bar at the top takes the next reading; what has been read stands under
 * it, a row apiece. Readings accumulate rather than replace, because the
 * optics get changed in the middle of a session and both settings stay worth
 * having — an overview taken dry at 5x and a detail taken at 63x in oil are
 * one run. One row is marked as the one the step is taken with, so switching
 * between them is a click rather than a second reading. */

/* The one mistake every reading after the overview's invites: importing
   with LAS X still on the overview's job. Said under the reading rather
   than refused -- the reading is fine as a reading, and a job can serve
   two steps when that is meant. */
const sameSettingAsTheOverview = (state) => (record) => {
  const job = record.changeable?.job;
  const overview = activeRecording(state.overviewPreset)?.changeable?.job;
  return job && overview && job === overview ? "Same setting as for the overview scan" : null;
};

/* Which step each recording is a setting of: the one whose box it is
   recorded in. */
const STEP_OF_SLOT = {
  overviewPreset: "scanfields", focusPreset: "focus", targetType: "select", targetFocus: "acquire",
};

/* A slot's options, filled in from the run: a step says which recording it
   is showing and what to do when it changes; where that recording is kept,
   and how to read the instrument, is the run's business. */
export const recordingOptions = (page, opts) => {
  const state = page.run;
  return {
    ...opts,
    slot: () => state[opts.key],
    setSlot: (next) => { state[opts.key] = next; page.stateEdited(STEP_OF_SLOT[opts.key]); },
    running: () => state.running,
    readSetting: (type, how) => page.backend.readSetting(type, how),
    warn: opts.warn ?? (opts.key === "overviewPreset" ? undefined : sameSettingAsTheOverview(state)),
  };
};

/* The tiles a field index names: the plan as it was scanned, which is how
   the bridge numbered the fields, and the plan itself before any scan. */
export const scannedPlan = (page) => page.run.scanned?.plan ?? page.run.plan;

/** Which compartment a field belongs to, for the per-tileset ceiling. */
export const tilesetOfField = (page, field) => {
  const t = scannedPlan(page)[field];
  return t ? (t.tileset ?? t.fieldId ?? field) : field;
};
