/**
 * The Detect objects step's channel: the detection settings, tried on one
 * position before the whole sample is run.
 *
 * Detection is the same shape as focus: the step happens on the canvas —
 * the cells it finds land there — and its controls sit in the channel
 * (`detection.js` builds them). This file hands them what they need from
 * the run and the backend.
 */

import { css, sizeCanvas } from "../../../../framework/window/dom.js";
import { status } from "../../../../framework/window/status.js";
import detectionPanel from "./detection.js";

/* Detection is judged by its masks, and coloured masks read best on
   quiet ground: running one, on a tile or over the sample, draws the
   overview in grey if it was not already. The chip in the canvas's row
   and the card's Grey press are the way back; nothing else switches it. */
export const overviewGoesGreyForTheMasks = () => {
  if (!window.__viewerPanel?.acquisitionGrey?.("overview")) window.__viewerPanel?.drawInGrey?.("overview", true);
};

export const detectionChannel = {
  id: detectionPanel.id,
  label: detectionPanel.label,
  mount(host, page) {
    const state = page.run;
    page.shown.detection = detectionPanel.mount(host, {
      settings: () => state.detect,
      /* Colour or grey is the overview's own, held on its chip in the
         canvas's row; the card reads it there and its Grey press flips
         the same switch. */
      inGrey: () => Boolean(window.__viewerPanel?.acquisitionGrey?.("overview")),
      setGrey: (grey) => window.__viewerPanel?.drawInGrey?.("overview", grey),
      plan: () => page.scannedPlan(),
      tryOn: (field, settings) => {
        overviewGoesGreyForTheMasks();
        return page.backend.discoverTargets({ fields: [field], settings }).then(({ fields, failed, stopped }) => {
          const found = fields?.[0];
          /* Stopped by the operator's hand before the field answered: the
             backend says so, and that is neither a field nor a failure. */
          if (!found && stopped) return { stopped: true };
          /* A field the bridge could not examine arrives under `failed` with
             the analysis's own sentence. Reading `fields[0]` regardless threw
             a TypeError, and the panel showed that instead of the reason. */
          if (!found) {
            throw new Error(failed?.[0]?.why ?? `position ${field + 1} was not examined`);
          }
          return { ...found, cells: found.cells.map(page.stage.toCarrier) };
        });
      },
      /* The same brake the step's own Run has: the bridge stops the field
         being segmented now, not at the next one. */
      stopTargets: () => page.backend.stopTargets?.(),
      pictureOf: (label) => page.pictureOf("overview", label),
      /* Which capture stands at a plan position: the scan filed each field's
         label as it landed, so the panel can show a field's picture without
         having tested anything on it. */
      labelOf: (field) => state.fieldLabels[field],
      /* The field's colorized segmentation, served beside its picture. */
      maskOf: (label) => {
        const where = page.backend.viewOf("overview");
        return where && label ? `${where}/${label}.mask.png` : null;
      },
      status,
      sizeCanvas, css,
      changed: () => { page.renderActionBar(); page.drawStage(); },
      edited: () => page.stateEdited("detect"),
    });
  },
};
