/**
 * Scanning the overview: drive the stage through every planned position,
 * capturing at each, and keep the picture growing as the tiles land.
 *
 * The backend runs the scan; this hands it the positions at the measured
 * focus height and follows its progress, moving the mark, the lit frame
 * and the picture as each field lands.
 */

import { status } from "../../../../framework/window/status.js";
import { activeRecording } from "../../../../parts/microscope/recordings.js";

/** How far through the scanned plan the scan is, worded once. */
const scanNote = (state) => `${state.tilesShown} / ${state.scanned?.plan.length ?? state.plan.length} tiles`;

export function runScan(page, s) {
  const state = page.run;
  const scanProgress = page.shown.scanProgress;
  state.tilesShown = 0;
  /* The tiles this scan takes: the ones pressed green in the box, when
     any are, and the whole plan otherwise -- always the whole plan under
     the protocol, whose run is the real one. Kept as the plan that was
     scanned, so every result is read against these tiles in this order,
     which is how the bridge numbers the fields it sends back. */
  const chosen = !state.protocol.running && state.testTiles.size
    ? [...state.testTiles].sort((a, b) => a - b) : state.plan.map((_, i) => i);
  state.scanned = { plan: chosen.map((i) => state.plan[i]), fields: chosen };
  scanProgress?.say({ start: true, of: chosen.length, doing: "starting the scan…" });
  return page.backend.scanOverview({
    /* Each position at the measured focus height for that place. One
       with no surface to read carries no height, and the bridge images
       it where the objective stands -- never at an invented zero. */
    positions: state.scanned.plan.map((p) => {
      const z = page.surfaceZAt(p.x, p.y);
      return page.stage.toStage(z === null ? p : { ...p, z });
    }),
    /* The recorded overview configuration, reapplied as the scan starts:
       a recording that gated the step and configured nothing left every
       capture on whatever job was selected. */
    state: activeRecording(state.overviewPreset)?.changeable ?? null,
    onProgress: (done) => {
      if (state.running !== s.id) return;
      /* Three polls a second, and most answer with nothing new. Only a
         field that landed is a reason to move the mark, read the run
         and draw the page again; a poll that found the count unchanged
         leaves the page and the picture alone. */
      if (done === state.tilesShown) return;
      state.tilesShown = done;
      const total = state.scanned.plan.length;
      page.protocolWithin(done, total);
      status.say(`scanning field ${done} of ${total}`);
      scanProgress?.say({
        done, of: total,
        doing: done < total ? `field ${done + 1} of ${total}` : "",
      });
      /* The lit frame follows the scan, as it follows the segmentation:
         on the field being taken now, not the one just finished. */
      state.detect.tile = Math.min(done, total - 1);
      /* The mark keeps up with the stage field by field, not every few
         seconds: the watch is asked now, and the bridge answers where
         the run sent the stage. The finished record's own position is
         not taken as the mark -- the stage has moved on to the next
         field by the time it lands, and a mark set from both flickered
         between the field just done and the one being taken. */
      page.stageWatch?.refresh();
      state.notes[s.id] = scanNote(state);
      /* Each position the scan reports is a reason to read the run again,
         because the tile it just saved is new picture that nothing on disk
         announces — the images were declared at their full size before any
         of them existed, so their description is the same before and after
         a tile lands. The picture decides how often to actually look; see
         `overview.js`, which explains why. */
      page.liveOverview.tileMayHaveLanded();
      page.drawStage(); page.renderAll();
    },
  }).then((outcome) => {
    /* The scan's records name every field's picture. Dropped, the test
       tile on the discover step stayed black until a discovery answered;
       kept, a field can be looked at the moment its scan is done. */
    (outcome?.records ?? []).forEach((r, i) => {
      if (r?.position_label) state.fieldLabels[i] = r.position_label;
    });
    /* The lit frame stays on the field the scan ended on, where the
       stage is; detection's test picker opens there too. */
    scanProgress?.say({
      ended: true,
      note: outcome?.stopped ? "stopped by hand" : `${outcome?.records?.length ?? state.scanned.plan.length} fields scanned`,
    });
    /* Put away once the scan is done: the picture is the whole answer,
       and the press's own note says how many fields it took. */
    if (scanProgress) scanProgress.group.style.display = "none";
    return outcome?.stopped ? { stopped: true, note: `stopped by hand — ${scanNote(state)}` } : {};
  }, (why) => {
    scanProgress?.say({ ended: true, note: why.message });
    throw why;
  });
}

/** Say the finished count, not whatever the last animation frame got to
    before it was cancelled. The tiles and the sentence about them come
    from one place, or a run that scanned everything reports one short. */
export function scanFinished(page, s) {
  const state = page.run;
  state.tilesShown = state.scanned.plan.length;
  state.notes[s.id] = scanNote(state);
  page.stageWatch?.refresh();
}
