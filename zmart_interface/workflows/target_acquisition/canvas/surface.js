/**
 * The canvas's own surface: where the operator pans and zooms, and where the
 * workflow's drawings go around the run's picture.
 *
 * Three things are stacked in the box: a drawing surface for what lies beneath
 * the picture, a middle slot the run's picture is put in, and a drawing surface
 * for what lies over it. The view — the place on the sample at the middle of the
 * box, and how much sample one screen pixel covers — is held here, and moves
 * only by the two gestures every canvas shares (`engines/gestures.js`) or when
 * the page asks. Everything registered to the canvas follows the view this
 * reports, which is how the picture in the middle and the drawings around it
 * stay one picture.
 *
 * Positions are in micrometres on the sample. A drawing is handed one frame:
 * the view, the box's size, a drawing context, and `project`/`unproject`
 * between micrometres and pixels from the top-left of the box.
 */

import { onlyPanAndZoom } from "./engines/gestures.js";

/**
 * Lay the surface down inside `element` and hand back the way to drive it.
 *
 * @param background what is behind everything; `"transparent"` for a host that
 *   draws something of its own beneath the canvas.
 * @param onViewChanged told the view, as it now is, every time it moves.
 */
export function openTheSurface(element, { background = "#05070d", onViewChanged = null } = {}) {
  const own = {
    element,
    background,
    onViewChanged,
    paintUnder: null,
    paintOver: null,
    view: { centre: { x: 0, y: 0 }, zoom: 1 },
    surfaces: null,
    size: null,
    frameAsked: false,
  };

  buildTheSurfaces(own);

  const handle = {
    setView({ centre, zoom } = {}) {
      if (centre && Number.isFinite(centre.x) && Number.isFinite(centre.y)) {
        own.view.centre = { x: Number(centre.x), y: Number(centre.y) };
      }
      if (Number.isFinite(zoom) && zoom > 0) own.view.zoom = Number(zoom);
      askForAFrame(own);
      own.onViewChanged?.(whereThingsAre(own));
    },

    getView() {
      return { centre: { ...own.view.centre }, zoom: own.view.zoom };
    },

    /** The element the run's picture is put in, between the two drawings. */
    get middleSlot() { return own.surfaces.middle; },

    /** Lend a drag out before it pans; see `engines/gestures.js`. */
    handDragsTo(handler) { gestures.handDragsTo(handler); },

    drawUnder(paint) {
      own.paintUnder = paint || null;
      askForAFrame(own);
    },

    drawOver(paint) {
      own.paintOver = paint || null;
      askForAFrame(own);
    },

    whereThingsAreDrawn() {
      return whereThingsAre(own);
    },
  };

  const gestures = onlyPanAndZoom(own.surfaces.box, {
    getView: () => handle.getView(),
    setView: (v) => handle.setView(v),
  });

  /* The view it opens on is not announced: nothing has moved yet, and a host
     still setting itself up should not be called into before it has finished. */
  askForAFrame(own);
  return handle;
}

/** The two drawing surfaces and the slot between them. */
function buildTheSurfaces(own) {
  const box = document.createElement("div");
  Object.assign(box.style, {
    position: "absolute", inset: "0", background: own.background, overflow: "hidden",
  });

  const drawingSurface = (zIndex) => {
    const canvas = document.createElement("canvas");
    Object.assign(canvas.style, {
      position: "absolute", inset: "0", width: "100%", height: "100%", display: "block", zIndex,
    });
    return canvas;
  };

  const under = drawingSurface("0");
  const middle = document.createElement("div");
  Object.assign(middle.style, { position: "absolute", inset: "0", zIndex: "1" });
  const over = drawingSurface("2");
  box.append(under, middle, over);
  own.surfaces = { box, under, middle, over };
  own.element.append(box);
  fitTheSurfaces(own);
}

/** Keep the drawing surfaces the box's size, in device pixels. */
function fitTheSurfaces(own) {
  const rect = own.element.getBoundingClientRect();
  const density = globalThis.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * density));
  const height = Math.max(1, Math.round(rect.height * density));
  for (const canvas of [own.surfaces.under, own.surfaces.over]) {
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  }
  own.size = { width: rect.width, height: rect.height, density };
}

/**
 * Where a point on the sample lands in the box, and back again: micrometres in,
 * browser pixels from the top-left of the box out.
 */
function whereThingsAre(own) {
  const { width = 0, height = 0, density = 1 } = own.size || {};
  const { centre, zoom } = own.view;
  const project = (x, y) => ({
    x: width / 2 + (x - centre.x) / zoom,
    y: height / 2 + (y - centre.y) / zoom,
  });
  const unproject = (x, y) => ({
    x: centre.x + (x - width / 2) * zoom,
    y: centre.y + (y - height / 2) * zoom,
  });
  return { centre: { ...centre }, zoom, width, height, density, project, unproject };
}

/** Draw on the next frame, once however many changes asked for it. */
function askForAFrame(own) {
  if (own.frameAsked) return;
  own.frameAsked = true;
  const draw = () => {
    own.frameAsked = false;
    drawBoth(own);
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(draw);
  else draw();
}

/**
 * Draw both surfaces. Each is cleared whether or not there is anything to draw:
 * an empty slot still has to leave an empty surface, or a drawing switched off
 * stays on screen.
 */
function drawBoth(own) {
  fitTheSurfaces(own);
  const where = whereThingsAre(own);
  const { density } = own.size;
  const clear = (canvas) => {
    const context = canvas.getContext("2d");
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.scale(density, density);
    return context;
  };
  const under = clear(own.surfaces.under);
  own.paintUnder?.({ ...where, context: under, coverage: null });
  const over = clear(own.surfaces.over);
  own.paintOver?.({ ...where, context: over, coverage: null });
}
