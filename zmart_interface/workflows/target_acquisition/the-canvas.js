/**
 * What this workflow puts on its canvas, wired to the page: the stage
 * picture, the live picture of the run being acquired, and the axes under
 * them.
 *
 * The canvas panel itself is a part (`parts/canvas/`) and knows nothing
 * about any workflow. This file is the workflow's side of it: it opens the
 * stage picture (`shared/stage.js`) and the live overview
 * (`steps/scan_the_overview/watching-the-run.js`) on that panel, hands them
 * the run and the few things they must be able to call back into, and gives
 * the page its own names for what it does to the picture.
 *
 * Everything the stage calls back into is reached through the page at call
 * time (`page.anchorPressed`, ...), because the steps that answer those calls
 * are wired after the canvas is.
 */

import { mountTheAxes } from "../../parts/canvas/axes.js";
import { showPublicationStatus } from "../../parts/canvas/publication-note.js";
import { css, el, sizeCanvas } from "../../framework/window/dom.js";
import carrierWidget from "./steps/define_carrier/carrier-panel.js";
import scanfieldsWidget from "./steps/define_scan_area/scanfield-editor.js";
import { watchTheRun } from "./steps/scan_the_overview/watching-the-run.js";
import { openTheStage } from "./shared/stage.js";

/**
 * Open the canvas on the page. Answers `stage`, `view`, `drawStage`,
 * `thePicture`, `liveOverview`, `theAxes`, the stage's readings
 * (`whereTheStageIs`, `carrierOriginUm`, `takeTheCanvas`, `takeThePosition`,
 * `drawScaleBar`) and `renderFramingPresses`.
 */
export function installTheCanvas(page, { isOpen = () => true } = {}) {
  const { run: state, panels: thePanels, step, indexOfStep } = page;

  /* The canvas panel this workflow declared, and everything that draws in it. */
  const theCanvas = thePanels.canvas;
  /* The T slider under the picture, on whichever picture is open. */
  const theAxes = mountTheAxes(theCanvas.parts, { picture: () => window.__thePicture ?? null });
  window.__theAxes = theAxes;

  /* The pictures of a real run — the overview being acquired, and the scan
     beneath the plan. The scan step's, so they live with it; this hands
     them the canvases and the projection and asks them to draw. */
  const { thePicture, liveOverview } = watchTheRun({
    pictureHost: theCanvas.parts.pictureHost,
    /* Where this backend's scans can be fetched from, if anywhere. The live
       one serves what the microscope wrote; the pretend one has nothing. */
    pictures: (kind) => (state.done.has("connect") ? page.backend?.viewOf?.(kind) : null) ?? null,
    /* The run's OME-Zarr sources, as the viewer server beside the bridge
       serves them — the real picture, linked position by position. `null`
       while there is none, and the JPEG copies stand in.

       Both answer nothing once the session is closed. The backend object
       outlives the session, and its addresses used to be handed out after
       Disconnect, so the page reopened an empty JPEG picture on a bridge
       that had no run to serve. */
    viewerSources: () => {
      const report = (status) => showPublicationStatus(theCanvas.parts.publicationNote, status);
      if (!state.done.has("connect")) { report(null); return null; }
      return page.backend?.viewerSources?.(report) ?? null;
    },
    connected: () => state.done.has("connect"),
    overviewCanvas: theCanvas.parts.overviewCanvas,
    overviewNote: theCanvas.parts.overviewNote,
    view: () => stage.pictureView(),
    carrierOriginUm: () => stage.carrierOriginUm(),
    /* Where the picture's own panel is mounted, out of sight; and the word
       that the picture came or went, so what wears its settings is drawn
       again. */
    displayHost: () => theCanvas.display,
    displayChanged: () => {
      theAxes.refresh();
      /* The gallery's pairs wear the picture's settings: rows that have just
         come -- the targets' own, at the end of their run -- are what its
         first pair should already be drawn with. */
      page.shown.gallery?.rebuild();
    },
    /* A display control changed after the panel was mounted. The available
       tabs did not change, only displayed copies that use the snapshot did.
       The gallery's pairs and the detection card both wear the overview's
       dress, colour or grey, so both are drawn again when it changes. */
    displaySettingsChanged: () => { page.shown.gallery?.rebuild(); page.shown.detection?.redraw(); },
    css,
  });

  /* The stage picture — the run drawn to scale, layer on layer. It is the
     workflow's, so it lives with the workflow; the framework hands it the canvas,
     the run, and the few things it must be able to call back into. */
  const stage = openTheStage({
    pictureHost: theCanvas.parts.pictureHost,
    box: theCanvas.parts.box,
    layerBar: theCanvas.parts.layerBar,
    tip: theCanvas.parts.tip,
    readout: theCanvas.parts.readout,
    carrierButton: theCanvas.parts.carrier,
    tilesetButton: theCanvas.parts.tileset,
    tileButton: theCanvas.parts.tile,
    masksBar: theCanvas.parts.masksBar,
    maskCells: theCanvas.parts.maskCells,
    maskName: theCanvas.parts.maskName,
    maskHow: theCanvas.parts.maskHow,
    maskEye: theCanvas.parts.maskEye,
    maskOpacityValue: theCanvas.parts.maskOpacityValue,
    channelPop: theCanvas.parts.channelPop,
    greyChip: theCanvas.parts.greyChip,
    greyChipMore: theCanvas.parts.greyChipMore,
    greyPop: theCanvas.parts.greyPop,
    maskPop: theCanvas.parts.maskPop,
    acquisitionPick: theCanvas.parts.acquisitionPick,
    acquisitionName: theCanvas.parts.acquisitionName,
    acquisitionEye: theCanvas.parts.acquisitionEye,
    acquisitionMenu: theCanvas.parts.acquisitionMenu,
    chips: theCanvas.parts.chips,
    channelsBox: theCanvas.parts.channelsBox,
    maskColours: theCanvas.parts.maskColours,
    maskFill: theCanvas.parts.maskFill,
    maskLine: theCanvas.parts.maskLine,
    maskOpacity: theCanvas.parts.maskOpacity,
    rampChip: theCanvas.parts.rampChip,
    legend: theCanvas.parts.legend,
    css, sizeCanvas, el,
    run: state,
    carrierWidget, scanfieldsWidget,
    activePreset: () => page.activePreset(),
    indexOfStep,
    sideWidget: () => page.sideWidget(),
    step: () => step(state.activeIdx),
    anchorPressed: (...a) => page.anchorPressed(...a),
    /* The list of anchors is drawn by the carrier panel, so a mark dragged on
       the picture has to tell it the numbers moved. A mark dragged on the
       picture is the carrier edited; a mark merely pressed is not, and the
       layer says which. */
    anchorsChanged: (moved = false) => { page.redrawAnchors(); if (moved) page.stateEdited("carrier"); },
    testTilesChanged: () => page.testTilesChanged(),
    /* A tile chosen on the canvas appears in the test box at once. */
    tileChosen: () => page.shown.detection?.redraw(),
    detectPressed: (...a) => page.detectPressed(...a),
    targetPressed: (...a) => page.targetPressed(...a),
    targetAt: (world, reachUm) => page.targetAt(world, reachUm),
    renderActionBar: () => page.renderActionBar(),
    renderRail: () => page.renderRail(),
    /* Whether the picture draws an acquisition of this name itself, so a
       layer that would print copies of it can leave the engine's own pixels
       to the display settings. */
    pictureShows: (name) => thePicture.shows(name),
    /**
     * Drive the stage to a place on the travel, and answer with where it
     * ended up — in micrometres per axis, the shape every reading takes.
     *
     * The picture asks for this when a place on it is double-clicked. Only
     * `x` and `y` are named: driving across the sample is not a request to
     * change how far the objective is from it.
     *
     * `null` when there is no session, when the run is driving the stage
     * itself, or when the instrument refused — and the mark then stays where
     * the last reading put it, which is the truth as far as the page knows it.
     */
    driveTo: async ({ x, y }) => {
      if (!page.backend?.set_xyz || state.running) return null;
      try {
        const at = await page.backend.set_xyz({ x, y });
        return {
          x: Number(at.x.position), y: Number(at.y.position),
          z: Number(at.z?.position ?? 0),
        };
      } catch (why) {
        console.warn(`the stage would not go there: ${why.message}`);
        return null;
      }
    },
    liveOverview, thePicture,
    focus: {
      focusPressed: (...a) => page.focusPressed(...a),
      focusCursor: (...a) => page.focusCursor(...a),
      focusDraggedTo: (...a) => page.focusDraggedTo(...a),
      focusGrabbed: (...a) => page.focusGrabbed(...a),
      focusHovered: (...a) => page.focusHovered(...a),
      focusMarqueeTo: (...a) => page.focusMarqueeTo(...a),
      focusMarqueeTook: (...a) => page.focusMarqueeTook(...a),
      drawFocusLayer: (...a) => page.drawFocusLayer(...a),
      drawFocusPoints: (...a) => page.drawFocusPoints(...a),
      marqueeing: () => page.focusMap.marqueeing(),
      dragging: () => page.focusMap.dragging(),
      endDrag: () => page.focusMap.endDrag(),
    },
  });

  /* Left where a test can reach it: what matters about a picture is what
     reached the screen, and only the page can be asked. */
  window.__theStageCanvas = {
    layers: () => stage.layers(),
    showLayer: (key, on) => stage.showLayer(key, on),
    layerShown: (key) => stage.layerShown(key),
    acquisitionOnShow: () => stage.acquisitionOnShow?.() ?? null,
    fadeTo: (value) => stage.fadeTo(value),
    plan: () => stage.plan(),
    targets: () => stage.targets(),
    project: (x, y) => stage.project(x, y),
    view: () => stage.pictureView(),
    lookAt: (where) => stage.lookAt(where),
    carrierOriginUm: () => stage.carrierOriginUm(),
    /* Acquisition Z is deliberately distinct from the flat picture's Z=0
       display plane. Evidence that publishes positions through the bridge
       must ask the same measured surface the real Step 5 Run path asks. */
    focusZAt: (x, y) => page.surfaceZAt(x, y),
  };

  /* The canvas's three framing presses -- carrier, tile set, tile -- are
     about a stage, and there is no stage until a session is open. They
     appear with the connection and go with it, rather than standing over
     an empty canvas offering to frame what is not there. */
  function renderFramingPresses() {
    const connected = state.done.has("connect");
    const parts = theCanvas.parts ?? {};
    for (const press of [parts.carrier, parts.tileset, parts.tile]) {
      if (press) press.hidden = !connected;
    }
  }
  /* Both only while this workflow is the one open: the page calls these
     for every workflow's render, and another workflow's steps are not this
     picture's business. */
  page.onRender.push(() => { if (isOpen()) renderFramingPresses(); });
  /* The acquired overview lies over the plan while the scan is what is being
     looked at, so which of the two is on screen follows the step. */
  page.onPanelShown.push((s, show) => { if (isOpen()) liveOverview.showFor(s, show); });

  /* A picture cannot be laid out while it is hidden: a hidden box has no
     size. So the panel re-measures when it comes up. */
  theCanvas.shown = () => stage.resize();
  const ro = new ResizeObserver(() => {
    if (theCanvas.host.classList.contains("on")) stage.resize();
  });
  ro.observe(theCanvas.host);

  return {
    stage, view: stage.view, theAxes, thePicture, liveOverview,
    drawStage: () => stage.draw(),
    carrierOriginUm: () => stage.carrierOriginUm(),
    whereTheStageIs: () => stage.whereTheStageIs(),
    takeTheCanvas: (reading) => stage.takeTheCanvas(reading),
    takeThePosition: (at) => stage.takeThePosition(at),
    drawScaleBar: (...a) => stage.drawScaleBar(...a),
    renderFramingPresses,
  };
}
