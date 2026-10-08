/**
 * The Acquire Targets step's channel: the gallery of acquired pairs, and
 * choosing one of them on the canvas.
 *
 * The gallery is `gallery.js`. What it shows and what it changes are handed
 * to it; the handle it gives back is how the step's run fills the cards in
 * once there are targets.
 */

import { emptySlot, activeRecording } from "../../../../parts/microscope/recordings.js";
import { renderRecordingSlot } from "../../shared/recording-slot.js";
import galleryWidget from "./gallery.js";
import { stopFollowingTheRun } from "./run.js";

/** Choose an acquired tile: the gallery shows its pair and the canvas
    outlines the physical frame. `quietly` is the gallery choosing for
    itself while it rebuilds, so it is not told what it just did. */
export function selectTarget(page, id, { quietly = false } = {}) {
  const state = page.run;
  if (!quietly) stopFollowingTheRun();
  if (state.selectedTarget === id && state.selectedQuietly === quietly) return;
  state.selectedTarget = id;
  state.selectedQuietly = quietly;
  if (!quietly) {
    page.shown.gallery?.chosen();
    page.renderActionBar();
  }
  /* Chosen by hand, the tile is where the operator is looking: the frame
     moves onto it and the picture centres on it, so Tile and Tile set go
     on from there. The gallery's own quiet choice of the newest frame, as
     a run grows, leaves the view where it is. */
  const tile = state.acquiredTiles[id]?.tile;
  if (!quietly && tile) {
    const index = tile.positionIndex ?? state.targetTiles.findIndex((one) => one.key === id);
    if (index >= 0) state.detect.targetTile = index;
    page.stage.standOn(tile);
  }
  page.stage.draw();
}

/** The acquired tile whose frame stands at a place on the sample, or null:
    the frame is the thing on the picture, so a press or a hover anywhere
    inside it means that acquisition. `reachUm` is a hand's reach in
    the sample's own units -- zoomed out to the plate a frame is smaller
    than a pixel, and a press within reach of its middle still means it. */
export function targetAt(page, world, reachUm = 0) {
  const state = page.run;
  let hit = null;
  let nearest = Infinity;
  for (const id of state.acquired) {
    const tile = state.acquiredTiles[id];
    if (!tile) continue;
    const half = Math.max(tile.frameUm / 2, reachUm);
    const dx = Math.abs(world.x - tile.x), dy = Math.abs(world.y - tile.y);
    if (dx <= half && dy <= half && Math.hypot(dx, dy) < nearest) { nearest = Math.hypot(dx, dy); hit = id; }
  }
  return hit;
}

/** A press on the canvas in the acquisition step: the frame under it, if
    one is, becomes the chosen one. */
export function targetPressed(page, px, py) {
  const state = page.run;
  if (page.step(state.activeIdx).mode !== "targets") return false;
  const hit = targetAt(page, page.stage.unproject(px, py), page.stage.umPerPixel() * 8);
  if (hit === null) return false;
  selectTarget(page, hit);
  return true;
}

/** Arriving to acquire the targets, the operator wants to see the sample
    again, in colour, with nothing over it. */
export function acquisitionArrived(page) {
  /* The overview went grey for the masks. Done once the step has
     rendered: the panel rebuilds its rows for the step, and a switch
     thrown before that was thrown at the old rows. */
  setTimeout(() => {
    if (window.__viewerPanel?.acquisitionGrey?.("overview")) {
      window.__viewerPanel?.drawInGrey?.("overview", false);
    }
  }, 0);
  /* The gallery's pictures wear the canvas's display settings, which may
     have changed since they were drawn: coming back to the step draws
     them again with the settings of now. */
  page.shown.gallery?.rebuild();
  /* The targets' lit shapes and the tiles' tint over the frames being
     imaged hide the very pixels the operator came to see: their eyes are
     pressed off on the way to the acquisition, and their cells stay in
     the strip. */
  page.stage.showLayer("cells", false);
  page.stage.showLayer("frames", false);
}

export const galleryChannel = {
  id: galleryWidget.id,
  label: galleryWidget.label,
  mount(host, page) {
    const state = page.run;
    page.shown.gallery = galleryWidget.mount(host, {
      acquired: () => state.acquired,
      tileByKey: (key) => state.acquiredTiles[key]?.tile,
      cellById: (id) => state.cells.get(id),
      /* Both halves wear the target display settings and cover the exact
         acquired frame, so the physical scale is directly comparable. Each
         is shown under its own acquisition's window: the two were exposed
         differently, and the overview crop under the targets' window came
         out black. */
      fieldOf: (tile, cell) => {
        const frame = state.acquiredTiles[tile.key];
        return {
          ...page.scannedPlan()[cell.field],
          cropX: frame?.x ?? cell.x,
          cropY: frame?.y ?? cell.y,
          cropFrameUm: frame?.frameUm ?? state.targetFrameUm,
          picture: page.pictureOf("overview", state.fieldLabels[cell.field]),
        };
      },
      pictureOf: (id) => {
        const where = page.pictureOf("targets", state.acquiredTiles[id]?.label ?? state.acquiredLabels[id]);
        /* Stamped by the capture, so a rerun's frame is a new address and
           the pair on show refreshes rather than keeping the old one. */
        const taken = state.acquiredTiles[id]?.taken;
        return where && taken ? `${where}&taken=${taken}` : where;
      },
      selected: () => state.selectedTarget,
      /* Whether the current selection is the gallery's own quiet follow
         rather than the operator's choice. */
      quiet: () => state.selectedQuietly === true,
      select: (id, opts) => selectTarget(page, id, opts),
      recordingSlot: (into, opts) => renderRecordingSlot(into, page.recordingOptions(opts)),
      changed: () => page.renderActionBar(),
      /* Focussing before each target: the switch, and the sentence under
         its own recording when the job read is one another step uses --
         a job left selected in LAS X from the step before is the usual
         cause, and it should be seen. A sentence, never a refusal. */
      focusOf: (key) => state.acquiredTiles[key]?.focus ?? null,
      focusOn: () => state.targetFocusOn,
      /* Unticked is as it was before the first tick: the job imported
         under the switch is forgotten, not kept out of sight. */
      setFocusOn: (on) => {
        state.targetFocusOn = !!on;
        if (!on) state.targetFocus = emptySlot("autofocus", 1);
        page.stateEdited("acquire");
        page.renderActionBar();
      },
      zOffsetUm: () => state.targetZOffsetUm,
      setZOffsetUm: (v) => { state.targetZOffsetUm = v; page.stateEdited("acquire"); },
      sameJobElsewhere: (record) => {
        const job = record.changeable?.job;
        if (!job) return null;
        const elsewhere = [
          [state.focusPreset, "Same job as the focus map's"],
          [state.overviewPreset, "Same job as the overview scan's"],
          [state.targetType, "Same job as the target acquisition's"],
        ];
        const hit = elsewhere.find(([slot]) => activeRecording(slot)?.changeable?.job === job);
        return hit ? hit[1] : null;
      },
    });
  },
};
