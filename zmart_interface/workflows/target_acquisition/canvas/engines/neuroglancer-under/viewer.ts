/**
 * Option A: neuroglancer draws the acquisition in a canvas of its own, and the
 * host places that canvas between its background and annotation layers. Opt-in
 * transparency keeps acquired pixels opaque without background cut-outs.
 *
 * This file is the only place in the whole application that knows neuroglancer
 * exists. Everything around it — the page, the two gestures in `../gestures.ts`,
 * the carrier outline, the tile rectangles, the measurements — is written
 * against the small interface in
 * `../contract.md` and would work just as well with a different engine
 * underneath. That is deliberate, and it is worth saying why it is worth the
 * trouble.
 *
 * Every import below comes from a folder the neuroglancer package itself calls
 * `unstable`, which is its way of saying "these are our insides and we may move
 * them". Scattered across an application, that promise is frightening: an
 * upgrade moves one file and a dozen places stop compiling, in a dozen different
 * ways, none of which mention neuroglancer. Gathered into one module it is
 * merely a chore: the upgrade breaks this file and the test that exercises it,
 * both of which are about neuroglancer and nothing else, and the rest of the
 * application does not notice.
 *
 * **So please do not import anything from `neuroglancer/unstable/...` anywhere
 * but here.** There is a check that nobody has:
 * `test_the_engine_stays_behind_its_adapter`, in
 * `viz_studio/tests/test_the_options_hold_together.py` (in ZMART-microscopy).
 *
 * ## What this file does differently from `frontend/src/engine.js`
 *
 * Four things, and each one is fixing something that made the older integration
 * awkward rather than being a matter of taste.
 *
 * 1. **Nothing lives in a module variable.** The older engine module keeps the
 *    addresses it has handed over, the counts it has seen and the queue of
 *    stores still to feed in variables belonging to the file itself, which means
 *    a page can hold exactly one viewer. Here every one of those lives on the
 *    instance, so two viewers can sit side by side — an overview and a detail
 *    scan, or the same run before and after a change — and neither disturbs the
 *    other. It also makes closing one genuinely close it.
 *
 * 2. **Addresses are passed in, never worked out.** The older scene builder puts
 *    `window.location.origin` in front of every store's address. That is right
 *    almost always and wrong exactly when it matters: served from somewhere
 *    else, or measured against a server on a port chosen at run time, it
 *    silently reads from the wrong place. Here the caller says where the data
 *    is, and an address without a scheme is refused outright rather than
 *    quietly never fetched — which is what neuroglancer does with one, with no
 *    error and no request. That was measured on the sandwich probe, whose
 *    write-up is `viz_studio/SANDWICH.md` (in ZMART-microscopy) — a file that is not on this
 *    branch; it lives on `sandwich-probe`, commit `1277e30`, in its
 *    last section.
 *
 * 3. **Bindings, background colour and layout are each set in exactly one
 *    place**, at the bottom of `start`. The engine's own gesture table is
 *    emptied on purpose: in this arrangement the operator's canvas lies over the
 *    engine and catches every gesture, so the engine's defaults — the plain
 *    wheel stepping through the stack, four different ways to rotate — can never
 *    fire. `CONTROLS.md` explains why each of those had to go.
 *
 * 4. **The picture is placed where the store says it is.** Our writer says where
 *    an image sits by giving the corner of its first voxel; the engine reads the
 *    same description as giving the middle of it, and so drew every acquisition
 *    half a voxel early — about half a screen pixel at an ordinary
 *    magnification, and four screen pixels when zoomed in to eight times full
 *    resolution. `countFromTheCornerOfTheVoxelRatherThanItsMiddle` puts that
 *    right, and says plainly what part of it a viewer cannot put right.
 *
 * The host owns the layer stack: application ground, this image, then marks.
 * In transparent 2D mode, authoritative acquired coverage keeps black image
 * pixels opaque while unacquired ground reveals the layer below.
 */

import "neuroglancer/unstable/util/polyfills.js";
import "neuroglancer/unstable/layer/enabled_frontend_modules.js";
import "neuroglancer/unstable/datasource/enabled_frontend_modules.js";
import "neuroglancer/unstable/kvstore/enabled_frontend_modules.js";
import { makeMinimalViewer } from "neuroglancer/unstable/ui/minimal_viewer.js";
import { WatchableCoordinateSpaceTransform } from "neuroglancer/unstable/coordinate_transform.js";
import { makeLayer, deleteLayer } from "neuroglancer/unstable/layer/index.js";
import "neuroglancer/unstable/ui/default_viewer.css";
import "./engine-chrome.css";
import { refreshSources } from "./source-refresh.ts";
import {
  shaderControlsFor as theViewersControls, shaderFor as theViewersProgram,
} from "zmart-viewer/drawing/programs.js";
import { theRangeAStoreHolds } from "../brightness.ts";
// And where to open looking, which the engines disagree about by a factor of
// twenty if left to themselves. See `../opening-view.ts`.
import { theViewThatShowsAllOf, type View } from "../opening-view.ts";
// And which plane of a stack to open on. This engine's own default is the
// middle of the volume, which is the same answer — but agreeing by coincidence
// is not agreeing. See `../planes.ts`.
import { theMiddlePlaneOf } from "../planes.ts";
// And where the specimen sits in the ground the run declared. This engine
// keeps the store to itself, so it is read here the way the window is.
import { whereTheSpecimenIsInThisStore } from "../where-the-specimen-is.ts";

/*
 * Neuroglancer's own objects -- the viewer, its layers, its navigation state,
 * its chunk manager -- come from the folders the package calls unstable, and
 * this file reaches into their fields on purpose (see above). They are typed
 * `any` here and in no other file: the one place that knows neuroglancer is
 * the one place allowed not to know its types.
 */
type Engine = any;

/** A place, in micrometres. */
interface XY {
  x: number;
  y: number;
}

/** A stretch of stored counts. */
interface Span {
  low: number;
  high: number;
}

/** What a published source is a view of: a projection, a stack. */
interface SourceView {
  type?: string;
  method?: string;
  [more: string]: unknown;
}

/** One channel of an acquisition, as the page describes it. */
export interface ChannelSpec {
  name?: string;
  colour?: number[];
  window?: Span | null;
  source?: string;
  sources?: string[];
  coverageSources?: string[];
  sourceDepths?: string[];
  sourceRevisions?: number[];
  sourceGeometryRevisions?: unknown[];
  view?: SourceView;
  channelIndex?: number;
  localPosition?: number[];
  visible?: boolean;
  weight?: number;
  [more: string]: unknown;
}

/** One acquisition to draw: its address, its name, and, if the page knows them, its channels. */
export interface Acquisition {
  url: string;
  name: string;
  channels?: ChannelSpec[];
  opaque?: boolean;
  embeddingUrl?: string;
  [more: string]: unknown;
}

/** One channel as the engine draws it: its stores, its look, and the engine layer that draws it. */
interface Row {
  url: string;
  sources: string[];
  coverageSources?: string[];
  sourceDepths?: string[];
  sourceRevisions: number[];
  sourceGeometryRevisions?: unknown[];
  view?: SourceView;
  acquisition: string;
  opaque: boolean;
  name?: string;
  layerName: string;
  logicalName: string;
  colour: number[];
  window: Span;
  channelIndex?: number;
  localPosition?: number[];
  visible: boolean;
  weight: number;
  gamma?: number;
  attenuation?: number;
  depth?: string;
  controlIndex?: number;
  managed: Engine | null;
}

/** The layer that says where an acquisition was imaged. */
interface CoverageLayer {
  managed: Engine;
  depth?: string;
  view?: SourceView;
  row: Row;
}

/** How big the box is, in browser pixels, and how many real pixels go to one. */
interface Size {
  width: number;
  height: number;
  density: number;
}

/** A rectangle in the box, in browser pixels. */
interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What `openViewer` is told. */
export interface OpenOptions {
  acquisitions?: Acquisition[];
  transparentBackground?: boolean;
  background?: string;
  presentation?: string;
}

/** Everything one viewer knows. */
interface Own {
  element: HTMLElement;
  transparentBackground: boolean;
  background: string;
  presentation: string;
  engineRect: Rect | null;
  engineHost: HTMLDivElement;
  viewer: Engine;
  rows: Row[];
  watchSize: ResizeObserver | null;
  stopWatchingTheSources: (() => void)[] | null;
  correctedLoadStates: WeakSet<object>;
  stoodOnTheTable: boolean;
  destroyed: boolean;
  /** Measured when the surfaces are built, before anything is drawn. */
  size: Size | null;
  coverageLayers?: Map<string, CoverageLayer>;
  sourceVersions?: Map<string, { revision: number; geometry: unknown }>;
  watchedSources?: WeakSet<object>;
  embedding?: Engine;
  embeddingUrl?: string;
  showingPicture?: boolean;
}

/**
 * Which of the engine's panel layouts to ask for, and which way round the axes
 * are handed over.
 *
 * These two go together and must be changed together. The engine decides what
 * goes across the window, what goes down it and what goes into the screen from
 * the order of the axis list *and* the named layout, and the two interact.
 * Handing the axes over widest-first and asking for `xy` puts width across the
 * window running to the right, height down it, and depth into the screen — the
 * plane an operator scrolls through, drawn the way round the specimen really is.
 *
 * The other pairing that also looks right — declared order with the layout `yz`
 * — draws every picture as a mirror image, and nothing anywhere reports it. That
 * shipped for months. `CONTROLS.md` §1a tells the story, and
 * `tests/test_the_picture_is_not_mirrored.py` is what stops it coming back.
 */
const FLAT_LAYOUT = "xy";

/** Metres to micrometres. The store speaks metres; the operator speaks µm. */
const UM_PER_M = 1e6;

/**
 * Open a viewer inside `element` and return the handle used to drive it.
 *
 * @param {HTMLElement} element  where the viewer draws; it fills this box
 * @param {object} options
 *   `acquisitions`  `[{ url, name, channels }]`, drawn in order with the first
 *                   at the bottom. Each `url` must be a whole address including
 *                   the scheme and host — see the note about addresses above.
 *                   `channels` is `[{ name, colour, window }]`, where `colour`
 *                   is three numbers from 0 to 1 and `window` is `{low, high}`
 *                   in the stored numbers' own units. It is **optional**: leave
 *                   it out and the viewer reads the run's own description of its
 *                   colours out of the store. Say it and what you say is used
 *                   unchanged.
 *   `background`    the page colour, as CSS text, so the seam between the two
 *                   drawing surfaces never shows.
 *   `presentation`  `"2d-overlay"` for sources placed in absolute stage z: the
 *                   picture opens at the lowest plane any stack holds, and a
 *                   flat source is kept in view at every depth (a published
 *                   projection through the shared depth binding). It changes
 *                   navigation and how a flat source's depth is read, never
 *                   where a source is placed.
 * @returns {Promise<Viewer>} the handle; see `../contract.md` for what it offers.
 *
 * It can fail in two ways worth knowing about: an address without a scheme is
 * refused straight away, and an acquisition that never says how big its voxels
 * are leaves the promise unresolved until the caller gives up. Both are far
 * better than the alternative, which is a viewer that opens onto nothing and
 * says everything is fine.
 */
export async function openViewer(element: HTMLElement, options: OpenOptions = {}): Promise<EngineViewer> {
  const {
    acquisitions = [],
    transparentBackground = false,
    background = "#000000",
    presentation = "source-geometry",
  } = options;

  for (const acquisition of acquisitions) {
    const addresses = [
      acquisition.url,
      ...(acquisition.channels ?? []).flatMap((channel) => channel.sources ?? []),
    ].filter(Boolean);
    for (const address of new Set(addresses)) {
      sourceAddressIsWhole(address, acquisition.name);
    }
  }

  // Everything the viewer knows lives in this one object, and it goes away when
  // the viewer does. Nothing is kept in a variable belonging to this file.
  const own: Own = {
    element,
    transparentBackground,
    background,
    presentation,
    // The rectangle within the box the engine is currently drawing in, in
    // browser pixels: the whole box.
    engineRect: null,
    engineHost: document.createElement("div"),
    viewer: null,
    // The channels, flattened across all acquisitions in the order they are
    // drawn, each remembering the engine layer that draws it.
    rows: [],
    watchSize: null,
    // How to stop listening for an acquisition's data arriving. Kept so that
    // closing the viewer really lets go of everything; see
    // `countFromTheCornerOfTheVoxelRatherThanItsMiddle` for what the listening
    // is for.
    stopWatchingTheSources: null,
    // The load states already moved back to the corner of their first voxel,
    // so a source is corrected once however many times the sources change.
    correctedLoadStates: new WeakSet(),
    // Whether the picture has been opened at the bottom of its stacks yet;
    // see `standOnTheTable`.
    stoodOnTheTable: false,
    destroyed: false,
    size: null,
  };

  buildTheTwoSurfaces(own);
  await start(own, acquisitions);
  return handleFor(own);
}

/** Refuse a source address that Neuroglancer would otherwise fail on silently. */
function sourceAddressIsWhole(address: string, acquisition: string) {
  if (/^[a-z]+:\/\//i.test(address)) return;
  throw new Error(
    `the acquisition "${acquisition}" was given the address ` +
      `"${address}", which has no scheme or host in it. ` +
      "Neuroglancer accepts such an address, builds the layer, raises no " +
      "error and then never fetches anything at all, so this is refused " +
      "here instead. Pass the whole address, including http:// and the host.",
  );
}

// ---------------------------------------------------------------------------
// The two surfaces
// ---------------------------------------------------------------------------

/**
 * Put the engine's canvas down in the box. The operator's drawing goes over it
 * from the canvas's own surface (`../../surface.ts`), not from here.
 *
 * Two lines of styling here were each learned the hard way and neither is
 * optional.
 *
 * The engine builds a small tree of elements of its own with a stacking order
 * inside it. Left alone those escape into the page's own order and end up
 * *above* anything placed after them, so the operator's drawing appears to be on
 * top while every click and drag is quietly caught by the engine's panel
 * underneath. Giving the engine's box a stacking order of its own keeps its
 * insides inside it.
 *
 * And the engine must not receive gestures at all, so it is made transparent to
 * the mouse rather than merely covered by something. The two gestures the
 * canvas's surface listens for are the only ones there are.
 */
function buildTheTwoSurfaces(own: Own) {
  const { element } = own;
  // Only set when it has not been decided already, so a page that has laid its
  // own box out is left alone. Absolute positioning inside needs *something*
  // positioned outside it, and `static` is the one value that will not do.
  if (getComputedStyle(element).position === "static") {
    element.style.position = "relative";
  }
  element.style.background = own.transparentBackground ? "transparent" : own.background;

  own.engineHost.className = "zmart-engine-underneath";
  Object.assign(own.engineHost.style, {
    position: "absolute",
    inset: "0",
    // One above the surface the bottom layer would go on, and one below the
    // operator's own. The three numbers are the three layers of
    // `viz_studio/THE_CANVAS.md` (in ZMART-microscopy), in order, written down in one place.
    zIndex: "1",
    pointerEvents: "none",
  });

  element.appendChild(own.engineHost);
  fitTheSurfaces(own);

  // The window can be resized, and the engine's drawing area is sized by writing
  // plain pixel numbers onto its element. Written once and never again, a
  // resized window leaves the engine drawing at the old size — and two surfaces
  // that disagree about how large the window is disagree about everything that
  // follows from it.
  own.watchSize = new ResizeObserver(() => {
    if (own.destroyed) return;
    fitTheSurfaces(own);
  });
  own.watchSize.observe(element);
}

/**
 * Measure the box, and make the engine's drawing area its size.
 *
 * The engine takes no account of screen density at all — measured, it draws one
 * canvas pixel per browser pixel and lets the browser scale it up. What that
 * costs is sharpness rather than registration: the geometry still agrees exactly,
 * and the picture is simply drawn at two thirds of the resolution a dense screen
 * could show. It is recorded in `viz_studio/SANDWICH.md` (in ZMART-microscopy) §7 — on the branch
 * `sandwich-probe`, commit `1277e30`, rather than on this one — and it
 * is not this file's to fix.
 */
function fitTheSurfaces(own: Own) {
  const density = window.devicePixelRatio || 1;
  const width = own.element.clientWidth;
  const height = own.element.clientHeight;
  own.size = { width, height, density };
  fitTheEngineToItsPatch(own);
}

/**
 * Write the box's size onto the engine's element.
 *
 * The engine's drawing area is sized by writing plain pixel numbers onto its
 * element; written once and not written again, a resized window leaves the
 * engine drawing at the old size, and two surfaces that disagree about how
 * large the window is disagree about everything that follows.
 */
function fitTheEngineToItsPatch(own: Own): Rect {
  const { width, height } = own.size || { width: 0, height: 0 };
  const rect: Rect = { left: 0, top: 0, width, height };
  const same = own.engineRect
    && own.engineRect.left === rect.left && own.engineRect.top === rect.top
    && own.engineRect.width === rect.width && own.engineRect.height === rect.height;
  own.engineRect = rect;
  if (same) return rect;
  own.engineHost.style.left = `${rect.left}px`;
  own.engineHost.style.top = `${rect.top}px`;
  own.engineHost.style.width = `${rect.width}px`;
  own.engineHost.style.height = `${rect.height}px`;
  tellTheEngineItHasBeenResized(own);
  return rect;
}

/**
 * Tell the engine at once that its drawing area has changed size.
 *
 * This is the one place that reaches past the engine's own arrangements, and it
 * earns its place, so it is worth explaining what it does and what happens
 * without it.
 *
 * The engine only re-reads how large it is when it notices a resize, and it
 * notices through the browser's own resize watcher — which reports *after* the
 * page has been laid out, and therefore after the engine has already drawn at
 * least one more frame at the old size. That one frame is drawn at one size and
 * stretched to fill another, so the picture in it is very slightly the wrong
 * scale and in the wrong place. Measured, that showed up as the two layers
 * coming apart by seventy screen pixels while the view was panned — not because
 * the operator's drawing was following the wrong thing, but because the engine's
 * own frame did not yet know how big it was.
 *
 * Nudging the engine's own count of resizes makes it re-read its size at the
 * start of the very next frame, before it draws anything, so the frame the
 * operator sees is drawn at the size it is displayed at. Asking for a redraw is
 * what makes that next frame happen at once rather than whenever something else
 * causes one. With this, the same measurement comes back to a single pixel.
 *
 * Both halves earn their place, and which fault each one prevents was measured
 * rather than assumed. With the whole of this taken out, the two layers came
 * apart by 69 screen pixels while panning and 71 while thrown about. With only
 * the count left out and the redraw kept, panning came back to 1 and zooming
 * stayed at 2 rather than 1 — so the redraw is what saves panning and the count
 * is what saves zooming.
 *
 * It reaches into a field rather than calling something, because there is
 * nothing to call. If a later version of the engine renames it, this file is
 * where it breaks, and the registration measurement is what says so.
 */
function tellTheEngineItHasBeenResized(own: Own) {
  const display = own.viewer?.display;
  if (!display) return;
  display.resizeGeneration += 1;
  display.scheduleRedraw?.();
}

// ---------------------------------------------------------------------------
// Opening the acquisitions
// ---------------------------------------------------------------------------

/**
 * Start the engine, hand it the acquisitions, and settle everything that is set
 * once.
 */
async function start(own: Own, acquisitions: Acquisition[]) {
  own.viewer = makeMinimalViewer({
    target: own.engineHost,
    showUIControls: false,
    showTopBar: false,
    showLayerPanel: false,
    showLocation: false,
    showPanelBorders: false,
    showLayerDialog: false,
    resetStateWhenEmpty: false,
    transparentBackground: own.transparentBackground,
  } as Parameters<typeof makeMinimalViewer>[0]);

  // -- the three things that are set in exactly one place, here ------------

  // Which panels are on screen. Paired with the axis order below; see FLAT_LAYOUT.
  own.viewer.layout.restoreState(FLAT_LAYOUT);

  // The engine's own furniture is off. It draws a cluster of layout buttons in
  // one corner, a panel of axis names in another, axis lines through the middle
  // and a scale bar per axis along the bottom — including one for time, which
  // looks like a distance and is not one. The page draws whichever of those it
  // wants, where it wants them, so none of this is a loss.
  own.viewer.showDefaultAnnotations.value = false;
  own.viewer.showAxisLines.value = false;
  own.viewer.showScaleBar.value = false;

  // The colour behind the picture, which is the page's own colour so that the
  // seam between the two drawing surfaces cannot be seen. This is the whole
  // point of the arrangement, and it is why the measurements deliberately use a
  // different colour: a margin you cannot see is a margin you cannot measure.
  own.viewer.crossSectionBackgroundColor.restoreState(own.background);

  // The engine's gesture table, emptied. In this arrangement the operator's
  // canvas lies over the engine and catches every gesture before the engine
  // could see one, so this is belt as well as braces — but an unbound gesture
  // and a gesture nobody tried look exactly alike, and a stacking order is one
  // stylesheet edit away from being wrong. `CONTROLS.md` sets out what each of
  // these used to do and why it had to go.
  emptyTheEnginesOwnBindings(own.viewer);

  // -- the acquisitions ---------------------------------------------------

  await loadAcquisitions(own, acquisitions);
}

async function loadAcquisitions(own: Own, acquisitions: Acquisition[]) {
  await loadEmbedding(own, acquisitions);
  own.rows = await rowsFor(acquisitions);
  if (own.destroyed || !own.rows.length) return;
  installRows(own);
  await refreshPublishedRows(own);
  await whenTheAxesAreKnown(own.viewer);
  if (own.destroyed) return;
  pinTheAxesThatMeasureDistance(own.viewer);
  startTimeAtTheFirstMoment(own.viewer);
  countFromTheCornerOfTheVoxelRatherThanItsMiddle(own);
  await finishOpeningAcquisitions(own, acquisitions);
}

async function loadEmbedding(own: Own, acquisitions: Acquisition[]) {
  const url = acquisitions.find(a => a.channels?.some(c => c.view))?.embeddingUrl;
  if (!url || own.embeddingUrl === url) return;
  const api = await import(/* @vite-ignore */ url);
  if (api.EMBEDDING_API_VERSION !== 1) throw new Error("Unsupported viewer embedding API");
  own.embedding = api;
  own.embeddingUrl = url;
}

/** A published projection is flat: it is kept in view at every depth the
    picture may stand at, rather than sitting on one plane of the shared Z. */
function bindNamedDepth(own: Own, row: Row, layer: Engine) {
  if (row.view?.type !== "projection") return;
  own.embedding.keepDepthLocal(layer, null, (value: Engine) => new WatchableCoordinateSpaceTransform(value));
}

/** Install only missing rows, keeping existing layers, controls and textures. */
function installRows(own: Own) {
  own.coverageLayers ??= new Map();
  let layerIndex = 0;
  /* Which acquisition a row belongs to, and whether it opens one: the
     channels of one acquisition add together, and an acquisition drawn over
     another covers it rather than mixing with it -- a target frame over the
     overview is a picture of its own, not the sum of two. */
  const acquisitionOf = (row: Partial<Row>) => `${row.acquisition ?? row.name?.split("/")[0] ?? ""}/${row.depth ?? ""}`;
  const baseAcquisition = acquisitionOf(own.rows[0] ?? {});
  for (const [at, row] of own.rows.entries()) {
    const opensAnAcquisition = own.rows.findIndex((one) => acquisitionOf(one) === acquisitionOf(row)) === at;
    if (opensAnAcquisition) for (const member of own.rows.filter(one => acquisitionOf(one) === acquisitionOf(row)
        && one.coverageSources?.length)) {
      let coverage = own.coverageLayers.get(member.layerName);
      if (!coverage) {
        const managed = makeLayer(own.viewer.layerSpecification, `__coverage__${member.layerName}`, {
          type: "image", source: member.coverageSources, opacity: 1,
          localPosition: member.localPosition ?? (member.channelIndex != null ? [member.channelIndex] : undefined),
          shader: "#uicontrol invlerp covered(range=[0,1], clamp=false)\n"
            + "void main() { emitRGBA(vec4(0.0,0.0,0.0,float(covered() > 0.0))); }",
        });
        own.viewer.layerSpecification.add(managed, layerIndex);
        bindNamedDepth(own, member, managed.layer);
        coverage = { managed, depth: member.depth, view: member.view, row: member };
        own.coverageLayers.set(member.layerName, coverage);
        const stop = managed.layer?.dataSourcesChanged?.add(
          () => countFromTheCornerOfTheVoxelRatherThanItsMiddle(own),
        );
        if (stop) (own.stopWatchingTheSources ??= []).push(stop);
      }
      const manager = own.viewer.layerManager;
      manager.reorderManagedLayer(manager.managedLayers.indexOf(coverage.managed), layerIndex++);
    }
    const coversWhatIsBelow = opensAnAcquisition && acquisitionOf(row) !== baseAcquisition
      && !row.coverageSources?.length;
    const position = layerIndex++;
    if (row.managed) {
      const manager = own.viewer.layerManager;
      manager.reorderManagedLayer(manager.managedLayers.indexOf(row.managed), position);
      row.managed.layer.blendMode.restoreState(coversWhatIsBelow ? "default" : "additive");
      continue;
    }
    const description = {
      type: "image",
      visible: own.showingPicture !== false && row.visible !== false,
      // Smart Viewer 0.2's central rule: every position store of one channel
      // is a source of the SAME layer.  Neuroglancer places each one from the
      // transform in its OME-Zarr metadata.  Flattening this array into one
      // acquisition per address is what produced 27 controls for a 3-channel,
      // 3-by-3 overview and is deliberately impossible here.
      source: row.sources.length === 1 ? row.sources[0] : row.sources,
      shader: programFor(row),
      shaderControls: controlsFor(row),
      // How solid this layer is. The engine's own default for an image layer is
      // a half, which is right for looking through one layer at another and
      // wrong for the channels of one acquisition, because those are separate
      // colours of the same specimen rather than one picture seen through
      // another. Measured on a run recorded in two colours: with the default
      // left alone the second channel reached the screen at 118 of a possible
      // 255 where the first reached 237 — the colour the run names, drawn at
      // half strength for no reason an operator could see.
      //
      // Nothing is lost by drawing each at its full strength, because what
      // decides where a layer is see-through here is the little program the
      // engine runs on the graphics card. It emits nothing at all where the
      // stored number is nought. A supplied coverage layer keeps acquired black
      // pixels opaque independently of that signal; unacquired ground stays clear.
      opacity: 1,
      /* Channels are added to one another, not painted over one another.
       *
       * They are separate colours of one specimen: a place that recorded both
       * green and red is yellow, and nothing about it is "green seen through
       * red". Stacked the ordinary way it is exactly that, because the shader
       * below is opaque wherever the stored number clears the window's floor —
       * so the channel drawn last covers every other one everywhere it has any
       * signal at all. Measured on a two-colour skin biopsy: 0.011% of the
       * window showed green against Viv's 0.029% on the same view, and Viv is
       * doing the arithmetic this asks the engine for.
       */
      // Additive, however many positions feed the row: Smart Viewer 0.2's
      // seam rule kept the engine's covering blend for a row of several
      // stores, so that overlapping edge voxels could not brighten into
      // seams; but under the covering rule the channel drawn last hid every
      // other one wherever it had any signal, and a nine-tile overview
      // showed as its last channel alone. The one exception is the first
      // channel of an acquisition drawn over another: it keeps the covering
      // blend, and the program above is opaque wherever it has data, so the
      // acquisition covers what is below it and its other channels add onto
      // it alone.
      ...(coversWhatIsBelow ? {} : { blend: "additive" }),
      // Where a store keeps its channels inside one array, this is what picks
      // the channel out: the engine offers it as a dimension belonging to the
      // layer, and each row pins it to its own index. Nothing splits the data —
      // one store feeds every row that reads from it.
      //
      // It is said here, in the description the layer is built from, rather than
      // written onto the layer afterwards. That is not tidiness. A layer built a
      // moment ago does not yet know what dimensions its data has, so writing a
      // position into it at that point writes into a space with no room in it
      // and is simply lost. Measured before it was moved here: a run with two
      // channels drew both of its layers from the same channel, so one colour
      // was missing and the other was drawn twice.
      ...(Array.isArray(row.localPosition)
        ? { localPosition: row.localPosition }
        : row.channelIndex != null
          ? { localPosition: [row.channelIndex] }
          : {}),
    };
    const managed = makeLayer(own.viewer.layerSpecification, row.layerName, description);
    own.viewer.layerSpecification.add(managed, position);
    row.managed = managed;
    bindNamedDepth(own, row, managed.layer);
    const stop = managed.layer?.dataSourcesChanged?.add(
      () => countFromTheCornerOfTheVoxelRatherThanItsMiddle(own),
    );
    if (stop) (own.stopWatchingTheSources ??= []).push(stop);
  }
  syncCoverageVisibility(own);
}

function syncCoverageVisibility(own: Own) {
  for (const coverage of own.coverageLayers?.values() ?? []) {
    coverage.managed.setVisible(own.showingPicture !== false
      && coverage.row.visible !== false);
  }
}

async function finishOpeningAcquisitions(own: Own, acquisitions: Acquisition[]) {
  // The engine chooses a starting magnification the first moment it believes it
  // knows what space the picture lives in, and for a moment that is an empty
  // space in which one voxel is one metre. Clearing it now makes it choose
  // again, this time knowing how big a voxel really is. Without this the viewer
  // opens on an empty rectangle with every piece of data present and correct.
  own.viewer.navigationState.zoomFactor.reset();
  own.viewer.perspectiveNavigationState.zoomFactor.reset();

  /* Having let the engine choose again, choose for it. Left alone it opens at one
     voxel to one screen pixel, which on a 1.1 µm store drops the operator inside
     the specimen at full magnification with nothing on screen to say where they
     are. Where a run opens is not a property of an engine — `../opening-view.js`
     holds the rule, and the Viv options obey the same one. Skipped where the box
     has not been measured yet, since fitting to a box of no size would be worse
     than the engine's own guess. */
  /* Where the specimen is, so the view opens on it rather than on the middle of
     the ground the run declared. One small read; nothing else waits on it. */
  const specimen = own.presentation !== "2d-overlay" && acquisitions.length
    ? await whereTheSpecimenIsInThisStore(acquisitions[0].url)
    : null;
  if (own.size && own.size.width > 0 && own.size.height > 0) {
    const ground = theGroundTheRunCovers(own);
    const showingAllOfIt = theViewThatShowsAllOf(
      ground && specimen
        ? { ...ground, specimenUm: theSpecimenInMicrometres(own, ground, specimen) }
        : ground,
      own.size,
    );
    if (showingAllOfIt) writeTheView(own, showingAllOfIt);
  }
  openOnThePlaneWhereTheSpecimenIs(own, specimen);
}

// ---------------------------------------------------------------------------
// What the run says about its own colours
// ---------------------------------------------------------------------------
//
// The page may describe an acquisition's channels — what each one is called,
// what colour to draw it in, and how bright to open it — and where it does, what
// it says is used exactly as given. But a page usually has no way of knowing any
// of that, because the description lives inside the store, which is the very
// thing it is asking this viewer to open. Making the page find out would mean
// opening the run twice: once by the page, to learn what to say, and once by the
// viewer, to draw it.
//
// So where the page says nothing, the description is read here instead, out of
// the `omero` block that every image this project writes carries.
// `zmart_storage/canvas.py` is where it is written, and it holds one entry per
// channel: a label, a colour as six hex digits, and a brightness window.
//
// Leaving this out has a plain and visible cost. With nothing to go on a viewer
// falls back to a single white channel, so **a run recorded in two colours shows
// only its first one**, in white, and nothing on screen says that the rest of
// the acquisition is missing.
//
// The four pieces below are word for word the same in all three options, on
// purpose. The three are meant to be comparable, and a difference in how they
// read the same description would show up in the results as a difference
// between the engines, which it is not. Two copies can drift apart, so **if you
// change one of these four, change the other two files to match in the same
// commit.**

/** The colour a channel is drawn in when nobody has named one. */
const WHITE = [1, 1, 1];

/**
 * The brightness range to open a channel at when neither the page nor the run
 * asked for one. It is the same range this viewer has always used in that case,
 * and it suits the twelve-bit cameras these runs are acquired on.
 */
const AN_ORDINARY_WINDOW = { low: 0, high: 4095 };

/**
 * Six hex digits, the way a run writes a colour, as the three numbers from 0 to
 * 1 the drawing works in.
 *
 * Anything that is not six hex digits is drawn white rather than refused. A
 * misspelt colour is a small blemish; refusing to open somebody's acquisition
 * over one would be a great deal worse.
 */
function colourFromTheStore(hex: unknown): number[] {
  if (typeof hex !== "string" || !/^[0-9a-f]{6}$/i.test(hex)) return [...WHITE];
  return [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
}

/**
 * The brightness range a channel should first be shown with, out of the run's
 * own description of it.
 *
 * A description holds two different ranges and telling them apart is the whole
 * of this function. `min` and `max` are the numbers the camera can produce at
 * all — nought to 65535 for a sixteen-bit camera — which is a fact about the
 * instrument and true of every acquisition it ever takes. `start` and `end` are
 * the range the picture should be *displayed* with, and they are written only
 * when the run actually asked for one.
 *
 * Only `start` and `end` are used here, and that is deliberate. A real
 * acquisition sits in the bottom few per cent of what the camera can count — a
 * few hundred counts of background with the signal not far above — so opening it
 * with the camera's whole range shows a picture that is very nearly black, and
 * it stays that way until somebody thinks to drag a contrast slider. This
 * project has already had that fault once and fixed it, which is why it is
 * spelled out here rather than left to whoever reads the description next.
 *
 * When the run asked for nothing, the ordinary window above is used — the same
 * one this viewer would have used had there been no description at all.
 */
function windowFromTheStore(described: Engine): Span | null {
  const range = described?.window ?? {};
  if (Number.isFinite(range.start) && Number.isFinite(range.end)) {
    return { low: range.start, high: range.end };
  }
  /* Nothing, rather than the ordinary window. A run that names a colour and says
     nothing about how to display it is not the same as a run that asked for the
     ordinary window, and answering as though it were is what put a real skin
     biopsy on a milky grey field. The caller reads the picture instead; only if
     that cannot be read does the guess come back. */
  return null;
}

/**
 * The channels a store describes, in the form this viewer keeps them in.
 *
 * `attributes` is the store's own description, as it was read from the image.
 * Nothing at all is returned when the store describes no channels, so that the
 * caller can fall back to whatever it did before rather than being handed an
 * empty list and drawing nothing.
 *
 * One limit, said plainly. What comes back is one entry per channel the
 * description *names*, not one per channel the picture holds. Everything this
 * project writes keeps the two in step, so for our own runs they are the same
 * list. A foreign image that stored four colours and described only two would
 * have two of them drawn here, and the operator would have to notice. Counting
 * the picture's own channels instead would mean a second reading of the image
 * for one of the three options and none for the other two, which is exactly the
 * kind of difference between them this comparison is trying not to introduce.
 */
function channelsTheStoreDescribes(attributes: Engine): ChannelSpec[] | null {
  const described = attributes?.omero?.channels;
  if (!Array.isArray(described) || !described.length) return null;
  return described.map((channel: Engine, at: number) => ({
    name: channel?.label || `channel ${at + 1}`,
    colour: colourFromTheStore(channel?.color),
    window: windowFromTheStore(channel),
  }));
}

/**
 * The run's own description of an acquisition, fetched from the store.
 *
 * This is the one place where this option has to work harder than the other two,
 * and the difference is worth knowing rather than hiding. Viv hands a store's
 * whole description back alongside the picture, so the two Viv options already
 * have it in their hands and reading the channels out of it costs them nothing.
 * Neuroglancer reads the same description — it has to, in order to build a layer
 * at all — but it keeps it to itself: what it gives back is a layer, not the
 * text the layer was built from. So the only honest way for this option to learn
 * what a run calls its colours is to go and ask for the description itself. That
 * is one small request per acquisition, made once while the viewer is opening.
 *
 * The address the page passes carries a short suffix telling the engine which
 * shape of store to expect, written after a vertical bar as in
 * `…/run.ome.zarr/|zarr2:`. It is taken off here so that the description can be
 * asked for by name.
 *
 * A store that will not answer is not a reason to refuse the acquisition, so
 * nothing at all is returned and the caller carries on with what it already has.
 *
 * @param {string} url the address the page gave for this acquisition.
 * @returns {Promise<object|null>} the store's description, or nothing.
 */
async function theRunsOwnDescription(url: string): Promise<Engine> {
  const bar = url.indexOf("|");
  const address = (bar < 0 ? url : url.slice(0, bar)).replace(/\/+$/, "");
  // The two versions of the format keep the description in different places.
  // Version 2 writes a small `.zattrs` file beside the picture; version 3 folds
  // the same thing into `zarr.json`, under `attributes`. Both are tried, so that
  // a run written either way opens the same.
  const spellings: [string, (doc: Engine) => Engine][] = [
    [".zattrs", (doc) => doc],
    // Version 3 folds the description into `zarr.json` under `attributes`,
    // and OME-Zarr 0.5 folds the OME half one level further, under an `ome`
    // key that holds `multiscales` and `omero` alike — so a 0.5 store read
    // only at `attributes` answered with neither, and a run written 0.5
    // opened as a single white channel however many colours it named.
    ["zarr.json", (doc) => doc?.attributes?.ome ?? doc?.attributes ?? doc],
  ];
  for (const [file, unwrap] of spellings) {
    try {
      // Never from the browser's own copy. These runs are written into while
      // somebody is watching them, and a viewer answering from a moment ago is
      // exactly what live viewing exists to avoid.
      const answer = await fetch(`${address}/${file}`, { cache: "no-store" });
      if (answer.ok) return unwrap(await answer.json());
    } catch {
      // One of the two spellings is expected to be missing, so a failure here is
      // ordinary. It is only worth saying something if both of them fail, which
      // is what happens below.
    }
  }
  console.warn(
    `the description of "${address}" could not be read, so nothing is known ` +
      "about the colours this run recorded. It will be drawn as a single white " +
      "channel, which is all there is to go on.",
  );
  return null;
}

/**
 * Turn the acquisitions into the flat list of rows the engine draws.
 *
 * One row per channel, in the order they should be drawn, the first at the
 * bottom. Numbering them across all the acquisitions rather than within each one
 * is what makes `setChannel(index, …)` a single sensible number for the page to
 * hold, and it matches how an operator reads the list on screen: one line per
 * thing that can be switched on and off.
 */
async function rowsFor(acquisitions: Acquisition[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (const acquisition of acquisitions) {
    const explicitlyDescribed = acquisition.channels && acquisition.channels.length;
    const itsOwnDescription = explicitlyDescribed
      ? null
      : await theRunsOwnDescription(acquisition.url);
    // What the page said, where it said anything; otherwise what the run says
    // about itself; and only if the run says nothing either, one white channel.
    const described: ChannelSpec[] = explicitlyDescribed
      ? acquisition.channels!
      : channelsTheStoreDescribes(itsOwnDescription)
        || [{ name: acquisition.name, colour: [...WHITE], window: null }];
    /* Whatever is still without a window is read out of the picture, one channel
       at a time.

       Not only the run that describes nothing. A run may name its colours and
       still say nothing about how to display them — a skin biopsy met here does
       exactly that, `omero` present with `"window": null` on both channels — and
       filling that gap with a guess about a camera puts a specimen whose
       background sits at 1990 counts on a milky grey field. Per channel, because
       two channels of one acquisition are routinely far apart: on that biopsy one
       reaches 4573 counts and the other 8859, and one window across the pair
       flattens whichever is fainter. That fault is already fixed once, in the
       viewer's own backend; this is the same fault in the canvas. */
    const channels: ChannelSpec[] = [];
    for (const [within, channel] of described.entries()) {
      const sources = channel.sources?.length
        ? [...channel.sources]
        : [channel.source ?? acquisition.url];
      channels.push(channel.window ? channel : {
        ...channel,
        sources,
        window: (await theRangeAStoreHolds(sources[0], {
          channel: channel.channelIndex ?? within,
        }))
          || { ...AN_ORDINARY_WINDOW },
      });
    }
    channels.forEach((channel, within) => {
      const sources = channel.sources?.length
        ? [...channel.sources]
        : [channel.source ?? acquisition.url];
      rows.push({
        url: sources[0],
        sources,
        coverageSources: channel.coverageSources,
        sourceDepths: channel.sourceDepths,
        sourceGeometryRevisions: channel.sourceGeometryRevisions,
        view: channel.view,
        sourceRevisions: [...(channel.sourceRevisions ?? sources.map(() => 0))],
        acquisition: acquisition.name,
        /* Whether every store of this acquisition is one imaged position and
           nothing else, so a layer may be opaque across its whole extent. */
        opaque: acquisition.opaque === true,
        name: channel.name,
        // The engine keeps one flat list of layers and needs their names to be
        // different from one another, and two acquisitions can easily hold a
        // channel of the same name — an overview and a detail scan both
        // recording green. So the name carries both halves.
        layerName: `${acquisition.name}/${channel.name}${channel.view ? "/" + (channel.view.method ?? channel.view.type) : ""}`,
        logicalName: `${acquisition.name}/${channel.name}`,
        colour: channel.colour || [...WHITE],
        window: channel.window || { ...AN_ORDINARY_WINDOW },
        // Which position along the store's channel axis this row reads from.
        // Said for every row, including a lone one, and that is worth a sentence
        // because it used not to be. Left unsaid, the engine picks a channel for
        // itself — the middle of however many the store holds — so a page that
        // named one channel of a two-channel run was shown the *second* one,
        // drawn in the colour it had asked for the first. Nothing on screen
        // could have told an operator that. The other two options have always
        // said which channel they mean, and now all three do.
        channelIndex: channel.channelIndex === undefined ? within : channel.channelIndex,
        localPosition: channel.localPosition,
        visible: channel.visible !== false,
        weight: channel.weight ?? 1,
        managed: null,
      });
    });
  }
  const expanded = rows.flatMap((row, controlIndex): Row[] => {
    const depths = row.sourceDepths;
    if (row.view || !depths) return [{ ...row, controlIndex }];
    return ["flat", "stack"].flatMap(depth => {
      const indices = depths.flatMap((kind, i) => kind === depth ? [i] : []);
      if (!indices.length) return [];
      const part: Row = { ...row, depth, controlIndex, layerName: `${row.layerName}/${depth}` };
      part.sources = indices.map(i => row.sources[i]);
      const covering = row.coverageSources;
      if (covering) part.coverageSources = indices.map(i => covering[i]);
      part.sourceRevisions = indices.map(i => row.sourceRevisions[i]);
      part.url = part.sources[0];
      return [part];
    });
  });
  return acquisitions.flatMap(acquisition => [undefined, "flat", "stack"].flatMap(depth =>
    expanded.filter(row => row.acquisition === acquisition.name && row.depth === depth)));
}

/**
 * Append acquisition/depth rows and refresh changed aggregates in place.
 *
 * Smart Viewer publishes stable aggregate addresses with completed revisions.
 * Another acquisition or depth kind can join an open picture without a reason
 * to destroy it: destroying revokes the old `/data/N/` endpoint while its
 * chunks are still in flight, and it also throws away navigation and operator
 * choices. This boundary accepts only the shape Viewer promises here — the
 * additional acquisition/channel rows and each old source list as an exact
 * prefix. Removing or replacing a source remains a genuinely different scene.
 */
async function addSourcesToTheOpenRows(own: Own, acquisitions: Acquisition[]): Promise<boolean> {
  await loadEmbedding(own, acquisitions);
  if (own.destroyed) return false;
  if (!own.rows.length) {
    await loadAcquisitions(own, acquisitions);
    return true;
  }
  const wanted = await rowsFor(acquisitions);
  if (own.destroyed) return false;
  const nextByName = new Map(wanted.map(row => [row.layerName, row]));

  for (const held of own.rows) {
    const next = nextByName.get(held.layerName);
    if (!next || !held.managed?.layer || next.sources.length < held.sources.length) {
      return false;
    }
    if (held.sources.some((source, sourceAt) => next.sources[sourceAt] !== source)) {
      return false;
    }
  }

  const heldByName = new Map(own.rows.map(row => [row.layerName, row]));
  for (const held of own.rows) {
    const layer = held.managed?.layer;
    if (!layer) return false;
    /* Every held row has its next, or the loop above returned. */
    const next = nextByName.get(held.layerName)!;
    const fresh = next.sources.slice(held.sources.length);
    for (const address of fresh) {
      sourceAddressIsWhole(address, held.acquisition);
      // Use the same data-source-specification path as initial layer creation,
      // so a position that lands later receives exactly the same OME-Zarr
      // handling and source-local transform as the first one.
      for (const source of layer.getDataSourceSpecifications({ source: [address] })) {
        layer.addDataSource(source);
      }
      held.sources.push(address);
    }
    held.sourceRevisions = next.sourceRevisions;
    held.sourceGeometryRevisions = next.sourceGeometryRevisions;
    held.controlIndex = next.controlIndex;
  }
  own.rows = wanted.map(row => {
    const held = heldByName.get(row.layerName);
    if (held) return held;
    const channel = own.rows.find(one => one.acquisition === row.acquisition && one.name === row.name);
    if (channel) {
      row.visible = channel.visible;
      row.colour = channel.colour;
      row.window = channel.window;
      row.weight = channel.weight;
      row.gamma = channel.gamma;
    }
    return row;
  });
  installRows(own);
  await refreshPublishedRows(own);
  countFromTheCornerOfTheVoxelRatherThanItsMiddle(own);
  return true;
}

/** Cache revisions belong to the viewer, for as long as it is open. */
async function refreshPublishedRows(own: Own) {
  const versions = own.sourceVersions ??= new Map();
  const nextVersions = new Map<string, { revision: number; geometry: unknown }>(), changed = new Set<string>();
  const refreshed = new Set(), forgotten = new Set(), geometryReads: Promise<unknown>[] = [];
  for (const row of own.rows) row.sources.forEach((url, at) => {
    const next = { revision: row.sourceRevisions[at], geometry: row.sourceGeometryRevisions?.[at] };
    const previous = versions.get(url);
    nextVersions.set(url, next);
    if (!previous || next.revision <= previous.revision) return;
    if (row.view && (next.geometry == null || next.geometry !== previous.geometry)) {
      const layers = [row.managed?.layer, own.coverageLayers?.get(row.layerName)?.managed.layer].filter(Boolean);
      for (const layer of layers) for (const source of layer.dataSources)
        geometryReads.push(own.embedding.refreshGeometry(source, own.viewer.chunkManager, refreshed, forgotten));
    } else {
      changed.add(url);
      for (const source of row.coverageSources ?? []) changed.add(source);
    }
  });
  await Promise.all(geometryReads);
  refreshSources(own.viewer.chunkManager, changed);
  for (const [url, version] of nextVersions) versions.set(url, version);
}

/**
 * Take away every gesture the engine binds for itself.
 *
 * The engine keeps a plain table mapping a gesture to an action, and it is ours
 * to write to. Emptying it is the one-line version of the long list in
 * `CONTROLS.md`: rotation bound four different ways, the plain wheel stepping
 * through the stack, ctrl and the wheel zooming, the right button recentring,
 * and a page-wide keyboard table whose space bar split the image into four
 * panels with no way back.
 *
 * The named tables are cleared rather than replaced, because replacing one with
 * an empty table of our own would leave whatever the engine adds in a later
 * version bound again.
 */
function emptyTheEnginesOwnBindings(viewer: Engine) {
  const tables = viewer.inputEventBindings;
  if (!tables) return;
  for (const name of Object.keys(tables)) {
    const table = tables[name];
    if (table && typeof table.clear === "function") table.clear();
    // Some of the tables are stacks of tables, and the parents are where the
    // engine's own defaults actually live.
    for (const parent of table?.parents ?? []) {
      if (parent && typeof parent.clear === "function") parent.clear();
    }
  }
}

/**
 * Wait until the images have said how big a voxel is.
 *
 * Until they have, the engine is working in a space with no axes at all, and
 * every conversion between the operator's micrometres and the screen would be
 * nonsense.
 */
function whenTheAxesAreKnown(viewer: Engine): Promise<void> {
  const { position } = viewer.navigationState;
  return new Promise<void>((done) => {
    const look = () => {
      if ((position.coordinateSpace.value?.rank ?? 0) === 0) return;
      stop();
      done();
    };
    const stop = position.coordinateSpace.changed.add(look);
    viewer.registerDisposer(() => { stop(); done(); });
    look();
  });
}

/**
 * Draw the axes that measure distance, and leave the rest to the page's sliders.
 *
 * An image says what each of its axes measures. Some are places in the specimen —
 * depth, height, width — and some are not: which moment this is, or which colour
 * of light was recorded. Only the first kind belongs on screen, and the engine
 * does not know that on its own: left alone it takes the first three axes in the
 * order they were written, which for a timelapse means drawing time against
 * depth and pinning width, so the specimen is nowhere on screen and nothing
 * reports a fault.
 *
 * Which axes measure distance is not guessed at. Metres are the only unit that
 * measures distance across a specimen; seconds do not, and an axis with no unit
 * does not.
 *
 * The order matters as much as the choice, and it is paired with `FLAT_LAYOUT`
 * at the top of this file. See the note there.
 */
function pinTheAxesThatMeasureDistance(viewer: Engine) {
  const space = viewer.navigationState.position.coordinateSpace.value;
  if (!space?.names) return;
  const distances: string[] = space.names.filter((_: string, at: number) => space.units?.[at] === "m");
  if (distances.length < 2) return;
  // Width first, depth last. An OME-Zarr image lists its distance axes
  // slowest-changing first — depth, height, width — so reversing them is what
  // puts width across the window and depth into the screen. The axes are
  // taken by name where they carry the usual ones, because they do not
  // always arrive in that order: a flat overview brings only width and
  // height (its depth stays its own, see
  // `countFromTheCornerOfTheVoxelRatherThanItsMiddle`), and the depth of a
  // stack that lands later is listed after them.
  const usual = ["x", "y", "z"];
  const facing = distances.every((name) => usual.includes(name))
    ? usual.filter((name) => distances.includes(name))
    : distances.slice(0, 3).reverse();
  // Called again whenever a source lands, so a depth that arrives after the
  // first pinning is taken into the screen too; the engine keeps the axes it
  // was given by name and would leave a later depth unseen. Left alone when
  // nothing has changed, so that this does not disturb the view.
  const { displayDimensions } = viewer.navigationState.pose;
  const now = Array.from<number>(displayDimensions.value?.displayDimensionIndices ?? [])
    .filter((at) => at >= 0)
    .map((at): string => space.names[at]);
  if (now.length === facing.length && now.every((name, at) => name === facing[at])) return;
  try {
    displayDimensions.restoreState(facing);
  } catch {
    // An engine that will not take them leaves the view as it was rather than
    // leaving the page broken. This runs while an operator is waiting for their
    // acquisition to appear, so it must not be the thing that stops it.
  }
}

/**
 * Open a timelapse at its first moment rather than half way through it.
 *
 * The engine opens every axis in the middle, which is right for the axes that
 * measure the specimen and wrong for time: a recording is watched from the
 * beginning. It also shows on screen, because a run declares room for all the
 * moments it might record and fills them in as it goes — so the middle of a run
 * in progress is a black screen with the data sitting at the start, unseen.
 */
function startTimeAtTheFirstMoment(viewer: Engine) {
  const { position } = viewer.navigationState;
  const space = position.coordinateSpace.value;
  if (!space?.names || !space.units) return;
  const at = Array.from(space.units).indexOf("s");
  if (at < 0) return;
  // Both conventions occur — a moment sitting on a whole number, or half way
  // between two — and the first moment has to be worked out for the one in use
  // or the view lands between two frames.
  const onWholeNumbers = space.bounds.voxelCenterAtIntegerCoordinates[at];
  const lower = space.bounds.lowerBounds[at];
  const first = onWholeNumbers ? Math.ceil(lower) : Math.ceil(lower - 0.5) + 0.5;
  if (!Number.isFinite(first) || position.value[at] === first) return;
  const moved = Float32Array.from(position.value);
  moved[at] = first;
  position.value = moved;
}

/**
 * Put the picture where the store says it is, rather than half a voxel before it.
 *
 * An image has to say where in the specimen its first voxel sits, and there are
 * two ways of saying it. The writer in this project gives the **corner** of that
 * voxel: an image of one-micrometre voxels beginning at nought has its first
 * voxel covering the ground from 0 µm to 1 µm, and the coverage record beside it
 * counts the same way. The description the writer leaves in the store is read by
 * neuroglancer under the other convention, in which the number given is the
 * **middle** of the first voxel — so the engine places the whole image half a
 * voxel earlier than the writer meant. That is not carelessness on the engine's
 * part. The file format's own text says middles, and our writer says corners
 * without ever writing it down, so each is being reasonable about a description
 * that does not say.
 *
 * Half a voxel sounds like nothing, and at the magnification the engine chooses
 * for itself it very nearly is: it comes to about half a screen pixel, because
 * the engine picks whichever stored resolution puts roughly one voxel in one
 * pixel. Zoom in past the finest resolution, though, and half a voxel keeps its
 * size in the specimen while a screen pixel shrinks. Measured on this page at
 * eight times full resolution, the edge of the picture sat four screen pixels
 * away from where the operator's drawing put it — which is exactly the moment an
 * operator is asking whether a tile's picture really landed inside the square
 * they laid out.
 *
 * So the layer is moved back by half a voxel, and two things make that a
 * conversion between two stated conventions rather than a fudge. It is half a
 * voxel *of the image*, not a number of screen pixels tuned on one machine, so
 * it holds at every magnification and on a screen of any density. And it is
 * applied only where the engine has said, in `voxelCenterAtIntegerCoordinates`,
 * that it is counting from the middle of a voxel; an image it has read the other
 * way round is left exactly as it is, which also means running this twice can do
 * no harm.
 *
 * Only the two axes drawn on the window are moved. Depth and time choose which
 * plane and which moment an operator is looking at rather than where anything is
 * drawn, and shifting those by half a step would change which plane `setPlane`
 * hands back without lining anything up.
 *
 * **What this does not cure.** The engine takes its half a voxel off every
 * stored resolution separately, so a coarse level of the pyramid is placed half
 * of *its own* voxel early — one and a half micrometres for a four-micrometre
 * level built from one-micrometre data. Only the finest level can be corrected
 * from here: the coarser ones are placed once, while the description is being
 * read, and are out of reach afterwards. So a view zoomed a long way out is
 * still up to half a screen pixel out, and a view zoomed in is exact. The
 * complete cure is for the writer to say which convention it means, by giving
 * each resolution in `zmart_storage/canvas.py` a translation of half its own
 * voxel; that would also line the resolutions up with one another, which they
 * are not today.
 */

function countFromTheCornerOfTheVoxelRatherThanItsMiddle(own: Own) {
  // A newly installed source can notify before initial framing. Select spatial
  // axes first: the engine's default axes may still include time or channels.
  pinTheAxesThatMeasureDistance(own.viewer);
  const space = own.viewer.navigationState.position.coordinateSpace.value;
  const shown = axesOnScreen(own.viewer);
  const drawnAcrossTheWindow = new Set(
    [space?.names?.[shown.across], space?.names?.[shown.down]].filter(Boolean),
  );
  if (!drawnAcrossTheWindow.size) return;
  for (const row of [...own.rows, ...(own.coverageLayers?.values() ?? [])]) {
    // Legacy sources need the corner correction; published aggregates already
    // describe voxel centres at every resolution.
    for (const source of row.managed?.layer?.dataSources ?? []) {
      const loadState = source?.loadState;
      const placing = loadState?.transform;
      if (!placing?.value || !placing.defaultTransform) {
        /* Not read yet. The list of sources changing is what brings this
           pass round, and a source that finishes loading after the list
           last changed would otherwise never be looked at -- the fourth
           field of a four-field overview stayed one voxel thick that way,
           and was not drawn. Asked once, when it has loaded. */
        own.watchedSources ??= new WeakSet();
        if (source?.changed && !own.watchedSources.has(source)) {
          own.watchedSources.add(source);
          source.changed.add(() => countFromTheCornerOfTheVoxelRatherThanItsMiddle(own));
        }
        continue;
      }
      /* Each loaded source is moved exactly once. Reading the engine's own
         flag afterwards is not enough: the layer's output space carries one
         flag for every source it holds, and the first correction flips it, so
         every later source of the same row read "already counted from the
         corner" while still standing where its description put it. A source
         that is loaded again gets a new load state and a fresh default
         transform, so it is moved again, which is right. */
      if (own.correctedLoadStates.has(loadState)) continue;
      if (row.depth || row.view) {
        // Aggregates already publish voxel-centre transforms. Only flat depth is local.
        own.correctedLoadStates.add(loadState);
        const output = placing.outputSpace.value;
        if (row.depth === "flat" && output.names.includes("z")) {
          placing.restoreState({ ...placing.toJSON(), outputDimensions:
            Object.fromEntries(output.names.map((name: string, i: number) =>
              [name === "z" ? "z'" : name, [output.scales[i], output.units[i]]])),
          });
        }
        continue;
      }
      const placed = placing.value;
      const { rank, outputSpace } = placed;
      const asRead = placing.defaultTransform;
      const stillAsRead = Array.from(asRead.transform ?? [])
        .every((value, at) => value === placed.transform[at]);
      // Do not shift a transform that the engine already moved.
      const shiftHalfAVoxel = stillAsRead;
      /* The engine's `voxelCenterAtIntegerCoordinates` flag is not read any
         more. Measured on 2026-09-02 with the review's target stores: a store
         whose translation is not a whole number of voxels is read with that
         flag false for y and x, and is still placed with its first voxel
         centre on the translation — its lower bound stood exactly half a
         voxel before the corner the writer meant, the same as a store read
         with the flag true. The flag says how the engine labels its axes; it
         does not say where the picture landed. Every store this project writes
         puts the corner of the first voxel in the translation
         (`zmart_interface/workflows/target_acquisition/storage/images.py`, `zmart_interface/workflows/target_acquisition/storage/zarr_positions.py`),
         so every source drawn here is moved back by the same half voxel. */
      const moved = Float64Array.from(placed.transform);
      let anythingMoved = false;
      for (let axis = 0; axis < rank; axis += 1) {
        if (!shiftHalfAVoxel || !drawnAcrossTheWindow.has(outputSpace?.names?.[axis])) continue;
        // Where the image sits is the last column of the matrix, and one unit
        // along an axis is one voxel of the finest stored resolution — so half
        // a voxel is simply a half.
        moved[rank * (rank + 1) + axis] += 0.5;
        anythingMoved = true;
      }
      own.correctedLoadStates.add(loadState);
      if (anythingMoved) placing.value = { ...placed, transform: moved };
    }
  }
  // A depth that arrived with this source is taken into the screen, and the
  // picture is opened at the bottom of it.
  standOnTheTable(own);
}

/** How many planes the deepest loaded source of one acquisition holds;
    0 when none of its sources has loaded yet. */
function planesDeepIn(own: Own, acquisition: string): number {
  let deepest = 0;
  for (const row of own.rows ?? []) {
    if ((row.acquisition ?? row.name?.split("/")[0]) !== acquisition) continue;
    for (const source of row.managed?.layer?.dataSources ?? []) {
      const placed = source?.loadState?.transform?.value;
      const inputSpace = placed?.inputSpace;
      const from = inputSpace?.names?.indexOf("z") ?? -1;
      if (from < 0 || !inputSpace?.bounds) continue;
      const planes = Math.round(inputSpace.bounds.upperBounds[from] - inputSpace.bounds.lowerBounds[from]);
      if (planes > deepest) deepest = planes;
    }
  }
  return deepest;
}

/** Plane centres and spacing of the stack aggregates, in their displayed Z.
    A published projection has no depth and is left out. */
function aggregateDepthIn(own: Own, acquisition: string | null) {
  let range: { lowUm: number; highUm: number; stepUm: number } | null = null;
  for (const row of own.rows) {
    if (row.depth !== "stack" || (acquisition !== null && row.acquisition !== acquisition)) continue;
    for (const source of row.managed?.layer?.dataSources ?? []) {
      const placement = source.loadState?.transform;
      const space = placement?.value?.outputSpace;
      const z = space?.names.findIndex((name: string) => name === "z" || name === "z'") ?? -1;
      if (z < 0) continue;
      for (const { box, transform } of space.boundingBoxes) {
        // Shared aggregates are axis-aligned; this coefficient retains native
        // plane spacing even when another acquisition changes the engine's units.
        const axes = Array.from(box.lowerBounds as ArrayLike<number>, (_, axis) => axis)
          .filter(axis => transform[axis * space.rank + z] !== 0);
        if (axes.length !== 1) continue;
        const axis = axes[0], scale = transform[axis * space.rank + z];
        const planes = box.upperBounds[axis] - box.lowerBounds[axis];
        if (!(planes > 1)) continue;
        const unit = space.scales[z] * UM_PER_M;
        const shift = transform[box.lowerBounds.length * space.rank + z];
        const stepUm = Math.abs(scale) * unit;
        const lowUm = (shift + Math.min(scale * box.lowerBounds[axis], scale * box.upperBounds[axis])) * unit + stepUm / 2;
        const highUm = lowUm + (planes - 1) * stepUm;
        if (![lowUm, highUm, stepUm].every(Number.isFinite) || !(stepUm > 0)) continue;
        range = range ? { lowUm: Math.min(range.lowUm, lowUm), highUm: Math.max(range.highUm, highUm),
          stepUm: Math.min(range.stepUm, stepUm) } : { lowUm, highUm, stepUm };
      }
    }
  }
  return range;
}


/**
 * Open the picture at the bottom of the stacks, once, when it first has a
 * depth to open at.
 *
 * Every stack is written in absolute stage z, lowest plane first, so the
 * bottom of the shared depth axis is the lowest plane there is, and the Z
 * slider under the picture reads "plane 1" there. The engine on its own
 * would open a depth that lands after the first source in the middle of
 * it. Only once: after that the depth is the operator's to choose, and a
 * stack landing later must not pull the view back down.
 */
function standOnTheTable(own: Own) {
  if (own.presentation !== "2d-overlay" || own.stoodOnTheTable) return;
  const info = own.viewer.navigationState.displayDimensionRenderInfo.value;
  const depth = info?.displayDimensionIndices?.[2] ?? -1;
  if (depth < 0) return;
  const bottom = theLowestPlaneOf(own, depth);
  if (bottom === null) return;
  own.stoodOnTheTable = true;
  const moved = Float32Array.from(own.viewer.navigationState.position.value);
  moved[depth] = bottom;
  own.viewer.navigationState.position.value = moved;
}

/**
 * The centre of the lowest plane on the shared depth axis, in the engine's
 * own coordinates, or null while no stack has declared a depth.
 *
 * Stores are written in absolute stage z (`zarr_positions.py`), so the
 * shared axis's lower bound is the lowest plane any stack holds; flat
 * flat aggregates keep their depth local and
 * do not pull the bound about. Integer coordinates are voxel centres on
 * this axis, so the first plane's centre is half a voxel in from the bound.
 */
function theLowestPlaneOf(own: Own, depth: number): number | null {
  const space = own.viewer.navigationState.position.coordinateSpace.value;
  const lower = space?.bounds?.lowerBounds?.[depth];
  if (!Number.isFinite(lower)) return null;
  return space.bounds.voxelCenterAtIntegerCoordinates?.[depth] ? lower + 0.5 : lower;
}

// ---------------------------------------------------------------------------
// The little program that runs on the graphics card
// ---------------------------------------------------------------------------

/**
 * The little program that turns stored numbers into what you see.
 *
 * It has two things to get right at once and they pull in opposite directions,
 * so both are worth stating.
 *
 * **The brightness has to reach the screen**, because turning the contrast
 * handles is how a microscopist finds their specimen. So the colour carries the
 * brightness: colour × value.
 *
 * **Ground nobody has imaged has to come out as nothing rather than as black.**
 * Most of a canvas is usually empty — the room is declared to the reach of the
 * stage and filled in as the run goes — so a row drawn opaque everywhere blacks
 * out every row below it. That means the transparency answers one question only:
 * was this spot imaged at all?
 *
 * Getting these the other way round is a real mistake with a confusing symptom.
 * For the bottom-most picture on screen the engine switches blending off
 * altogether and writes the colour straight out, using the transparency only as
 * a yes-or-no test — so brightness put into the transparency simply never
 * arrives, and every contrast window draws the same flat shape.
 *
 * The numbers for the window are sent separately, as values for a control the
 * program declares, so that dragging a contrast handle reaches a program that is
 * already compiled instead of causing a fresh one to be built several times a
 * second.
 *
 * **The programs are the ZMART viewer's.** The viewer's own window draws with
 * exactly these, and operators have learned to read their specimens by that
 * look, so there is one copy, in the viewer (`programs.js` in its `drawing`
 * folder), and this page's build takes it from the installed viewer. This page
 * asks for one thing the viewer's window does not offer yet: gamma, which bends
 * the curve between the window's ends.
 */
function programFor(row: Row): string {
  return theViewersProgram(false, null, row.opaque, { gamma: true });
}

/**
 * Every shader control of one row, as one whole object.
 *
 * Always restored whole, never piecewise: a partial restore is how one
 * control quietly resets another to its default.
 */
function controlsFor(row: Row) {
  const [red, green, blue] = row.colour;
  return theViewersControls(row.window, false, row.weight ?? 1, [red, green, blue], null,
    row.attenuation ?? 0, row.gamma ?? 1);
}


// ---------------------------------------------------------------------------
// Micrometres in, micrometres out
// ---------------------------------------------------------------------------
//
// The engine has a notion of zoom of its own, and it is not one the operator
// should ever meet. It counts in "canonical voxels per screen pixel", where a
// canonical voxel is the smallest voxel among the axes on screen — a number that
// changes meaning when a different acquisition is opened. The store and the
// stage both speak micrometres, so that is what crosses this boundary, and the
// conversion lives here and nowhere else.
//
// The arithmetic, so it can be checked rather than trusted. The engine works out
// how many voxels of an axis fall in one screen pixel as
// `zoomFactor / canonicalVoxelFactors[i]`, and `canonicalVoxelFactors[i]` is the
// size of that axis's voxel divided by the canonical one. Multiply those and the
// axis drops out: metres per screen pixel is simply
// `zoomFactor × canonicalVoxelPhysicalSize`, whichever axis you ask about.

/** Where each axis on screen sits in the image's own list, and how big it is. */
function axesOnScreen(viewer: Engine) {
  const info = viewer.navigationState.displayDimensionRenderInfo.value;
  const space = viewer.navigationState.position.coordinateSpace.value;
  const across = info.displayDimensionIndices[0];
  const down = info.displayDimensionIndices[1];
  return {
    across,
    down,
    // Micrometres per voxel along each axis on screen.
    umAcross: (space?.scales?.[across] ?? 0) * UM_PER_M,
    umDown: (space?.scales?.[down] ?? 0) * UM_PER_M,
    umPerCanonicalVoxel: info.canonicalVoxelPhysicalSize * UM_PER_M,
  };
}

/**
 * Put the view on the plane a stack should open on.
 *
 * Said rather than inherited. Left alone this engine opens in the middle of its
 * volume, which is the answer `planes.ts` gives — so the three options agreed
 * because two of them were told and the third happened to. A default that changed
 * on a version bump would have shown one engine a different slice of tissue from
 * the other, and nothing in the comparison would have said so.
 */
/**
 * The specimen's position turned from voxels of the store into micrometres of
 * stage, which is what every option speaks.
 */
function theSpecimenInMicrometres(own: Own, ground: { atUm: XY }, specimen: Record<string, number>): XY | null {
  const axes = axesOnScreen(own.viewer);
  if (!(axes.umAcross > 0) || !(axes.umDown > 0)) return null;
  if (specimen.x === undefined || specimen.y === undefined) return null;
  return {
    x: ground.atUm.x + specimen.x * axes.umAcross,
    y: ground.atUm.y + specimen.y * axes.umDown,
  };
}

function openOnThePlaneWhereTheSpecimenIs(own: Own, specimen: Record<string, number> | null) {
  const info = own.viewer.navigationState.displayDimensionRenderInfo.value;
  const space = own.viewer.navigationState.position.coordinateSpace.value;
  const depth = info?.displayDimensionIndices?.[2] ?? -1;
  if (depth < 0 || !space?.bounds) return;
  const moved = Float32Array.from(own.viewer.navigationState.position.value);
  if (own.presentation === "2d-overlay") {
    /* The picture opens at the lowest plane any stack holds -- absolute
       stage z, as the writer places it. Navigation only selects that plane;
       it never rewrites a placement or infers one from whichever source
       loaded first. */
    const bottom = theLowestPlaneOf(own, depth);
    if (bottom === null) return;
    moved[depth] = bottom;
    own.viewer.navigationState.position.value = moved;
    own.stoodOnTheTable = true;
    return;
  }
  const planes = Math.round(
    space.bounds.upperBounds[depth] - space.bounds.lowerBounds[depth],
  );
  if (!(planes > 1)) return;
  // Where the specimen is, where it could be found; the middle of the declared
  // stack otherwise, which is what this did before and is right when a run fills
  // the room it asked for.
  const plane = specimen?.z ?? theMiddlePlaneOf(planes);
  moved[depth] = space.bounds.lowerBounds[depth] + plane + 0.5;
  own.viewer.navigationState.position.value = moved;
}

/**
 * How much ground the open acquisitions cover, in micrometres.
 *
 * Read out of the engine's own coordinate space rather than from the stores,
 * because by this point the engine has read every store it was given and its
 * space spans all of them — so a page opening a wide survey and a detailed scan
 * over it gets the pair, without this having to know there were two.
 *
 * The bounds are in voxels of each axis, so each is turned into micrometres by
 * that axis's own scale; the two axes of a light-sheet store are rarely the same
 * size.
 */
function theGroundTheRunCovers(own: Own) {
  const axes = axesOnScreen(own.viewer);
  const space = own.viewer.navigationState.position.coordinateSpace.value;
  const bounds = space?.bounds;
  if (!bounds || !(axes.umAcross > 0) || !(axes.umDown > 0)) return null;
  const low = { x: bounds.lowerBounds[axes.across], y: bounds.lowerBounds[axes.down] };
  const high = { x: bounds.upperBounds[axes.across], y: bounds.upperBounds[axes.down] };
  if (![low.x, low.y, high.x, high.y].every(Number.isFinite)) return null;
  return {
    atUm: { x: low.x * axes.umAcross, y: low.y * axes.umDown },
    wideUm: (high.x - low.x) * axes.umAcross,
    tallUm: (high.y - low.y) * axes.umDown,
  };
}

/** The view the engine is showing now, in micrometres. */
function readTheView(own: Own): View {
  const axes = axesOnScreen(own.viewer);
  const position = own.viewer.navigationState.position.value;
  const zoom =
    own.viewer.navigationState.zoomFactor.value * axes.umPerCanonicalVoxel;
  return {
    centre: {
      x: position[axes.across] * axes.umAcross,
      y: position[axes.down] * axes.umDown,
    },
    zoom,
  };
}

/** Tell the engine where to look, in micrometres. */
function writeTheView(own: Own, asked: { centre?: XY; zoom?: number }) {
  const axes = axesOnScreen(own.viewer);
  const navigation = own.viewer.navigationState;
  const now = readTheView(own);
  const centre = asked.centre || now.centre;
  const zoom = asked.zoom !== undefined && asked.zoom > 0 ? asked.zoom : now.zoom;
  if (axes.umAcross > 0 && axes.umDown > 0) {
    const position = Float32Array.from(navigation.position.value);
    position[axes.across] = centre.x / axes.umAcross;
    position[axes.down] = centre.y / axes.umDown;
    navigation.position.value = position;
  }
  if (zoom > 0 && axes.umPerCanonicalVoxel > 0) {
    navigation.zoomFactor.value = zoom / axes.umPerCanonicalVoxel;
  }
}

/** Which fraction of the flat picture is currently inside the engine panel. */
function measurementBoxFor(own: Own): [[number, number], [number, number]] | null {
  const { position } = own.viewer.navigationState;
  const space = position.coordinateSpace.value;
  if (!space?.rank) return null;
  const render = own.viewer.navigationState.pose.displayDimensionRenderInfo.value;
  const drawn = Array.from<number>(render?.displayDimensionIndices ?? []).slice(0, 2);
  if (drawn.length < 2) return null;
  let viewport = null;
  for (const panel of own.viewer.display?.panels ?? []) {
    if ("sliceView" in panel) viewport = panel.renderViewport;
  }
  if (!viewport?.logicalWidth || !viewport?.logicalHeight) return null;
  const zoom = own.viewer.navigationState.zoomFactor.value;
  const { lowerBounds, upperBounds } = space.bounds;
  const centre = position.value;
  const names = Array.from<string>(space.names);
  const share: Record<string, [number, number]> = {};
  drawn.forEach((axis, slot) => {
    const factor = render.canonicalVoxelFactors[slot] || 1;
    const pixels = slot === 0 ? viewport.logicalWidth : viewport.logicalHeight;
    const half = (pixels / 2) * (zoom / factor);
    const low = lowerBounds[axis];
    const high = upperBounds[axis];
    if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return;
    share[names[axis]] = [
      (centre[axis] - half - low) / (high - low),
      (centre[axis] + half - low) / (high - low),
    ];
  });
  if (!share.y || !share.x) return null;
  return [[share.y[0], share.x[0]], [share.y[1], share.x[1]]];
}

// ---------------------------------------------------------------------------
// The handle
// ---------------------------------------------------------------------------

/** The handle the canvas drives this engine with; `../contract.md` says what each part is for. */
export type EngineViewer = ReturnType<typeof handleFor>;

function handleFor(own: Own) {
  return {
    /**
     * Grow stable acquisition rows in place. Returns false when their shape
     * changed and the caller therefore needs to open a different scene.
     */
    addSources(acquisitions: Acquisition[]) {
      return addSourcesToTheOpenRows(own, acquisitions);
    },

    /** Move the view. `centre` is in micrometres, `zoom` in µm per screen pixel. */
    setView(view: { centre?: XY; zoom?: number }) {
      writeTheView(own, view);
    },

    /** The view now on screen, in the same units. */
    getView() {
      return readTheView(own);
    },

    /** The visible flat rectangle, normalized for Smart Viewer's measure API. */
    measurementBox() {
      return measurementBoxFor(own);
    },

    /**
     * Which plane of the stack to show, in micrometres along the depth axis.
     *
     * Moving through the stack lives on a slider rather than on a gesture,
     * where it is visible and labelled — see `CONTROLS.md`.
     */
    /**
     * How deep the stack is, so a page can offer a way through it.
     *
     * Read out of the engine's own coordinate space, which spans every
     * acquisition it has been given, and in the same micrometres `setPlane`
     * counts in — the two are useless apart. Nothing when there is no depth to
     * speak of: a single plane is not a stack.
     */
    theDepthItCanShow(acquisition: string | null = null) {
      const info = own.viewer.navigationState.displayDimensionRenderInfo.value;
      const space = own.viewer.navigationState.position.coordinateSpace.value;
      const depth = info?.displayDimensionIndices?.[2] ?? -1;
      if (depth < 0 || !space?.bounds) return null;
      const umPerVoxel = space.scales[depth] * UM_PER_M;
      if (own.rows.some(row => row.depth || row.view)) {
        /* Aggregates: the stacks' own planes, and none for a projection. */
        const range = aggregateDepthIn(own, acquisition);
        return range && { ...range,
          atUm: own.viewer.navigationState.position.value[depth] * umPerVoxel };
      }
      /* The engine's own space spans every acquisition it holds. Asked
         about one, the answer is that one's: the deepest of its loaded
         sources, so a flat overview beside a stack is still flat. */
      const planes = acquisition === null
        ? Math.round(space.bounds.upperBounds[depth] - space.bounds.lowerBounds[depth])
        : planesDeepIn(own, acquisition);
      if (!(umPerVoxel > 0) || !(planes > 1)) return null;
      /* Counted from the first plane, not from the engine's own lower bound.
         Those differ by half a voxel — this engine puts its bounds at voxel
         *edges*, so a 833-plane stack at 5 µm reports itself as starting at
         −2.5 µm — and a depth control that opens at minus two and a half
         micrometres is describing the engine's arithmetic rather than the
         specimen. It also has to match what `setPlane` below consumes, which
         counts plane k at k voxels from the store's origin, and it has to match
         what the other options answer, or the same stack is two different
         depths depending on which engine happens to be drawing. */
      const now = own.viewer.navigationState.position.value[depth];
      return {
        lowUm: 0,
        highUm: (planes - 1) * umPerVoxel,
        stepUm: umPerVoxel,
        // Where the picture is now, counted from the first plane like the rest.
        atUm: Math.max(now - space.bounds.lowerBounds[depth] - 0.5, 0) * umPerVoxel,
      };
    },

    setPlane(z: number) {
      const info = own.viewer.navigationState.displayDimensionRenderInfo.value;
      const space = own.viewer.navigationState.position.coordinateSpace.value;
      const depth = info.displayDimensionIndices[2];
      if (depth < 0 || !space) return;
      const umPerVoxel = space.scales[depth] * UM_PER_M;
      if (!(umPerVoxel > 0)) return;
      const moved = Float32Array.from(own.viewer.navigationState.position.value);
      moved[depth] = z / umPerVoxel;
      if (moved[depth] === own.viewer.navigationState.position.value[depth]) return;
      own.viewer.navigationState.position.value = moved;
    },

    /**
     * How long the timelapse is, so a page can offer a way along it: how many
     * moments, and which one is on screen, counted from the first. Nothing
     * when there is only one moment: a single frame is not a timelapse.
     */
    theMomentsItCanShow() {
      const space = own.viewer.navigationState.position.coordinateSpace.value;
      if (!space?.units || !space.bounds) return null;
      const at = Array.from(space.units).indexOf("s");
      if (at < 0) return null;
      const many = Math.round(space.bounds.upperBounds[at] - space.bounds.lowerBounds[at]);
      if (!(many > 1)) return null;
      const onWholeNumbers = space.bounds.voxelCenterAtIntegerCoordinates[at];
      const lower = space.bounds.lowerBounds[at];
      const first = onWholeNumbers ? Math.ceil(lower) : Math.ceil(lower - 0.5) + 0.5;
      const now = own.viewer.navigationState.position.value[at];
      return { many, at: Math.min(Math.max(Math.round(now - first), 0), many - 1) };
    },

    /** Which moment of a timelapse to show, counted from the first. */
    setMoment(t: number) {
      const space = own.viewer.navigationState.position.coordinateSpace.value;
      if (!space?.units) return;
      const at = Array.from(space.units).indexOf("s");
      if (at < 0) return;
      const onWholeNumbers = space.bounds.voxelCenterAtIntegerCoordinates[at];
      const lower = space.bounds.lowerBounds[at];
      const first = onWholeNumbers ? Math.ceil(lower) : Math.ceil(lower - 0.5) + 0.5;
      const moved = Float32Array.from(own.viewer.navigationState.position.value);
      moved[at] = first + t;
      own.viewer.navigationState.position.value = moved;
    },

    /**
     * Draw the acquisitions, or do not — the viewer stays open either way.
     *
     * Turning the picture off used to mean opening the canvas again with no
     * acquisitions at all, and on this engine that does not work: neuroglancer
     * takes its axes from its image layers, so with no images there is nothing
     * to take them from and opening never finishes. Measured from the page, both
     * presses of the button cost 26.7 seconds and the picture never went off —
     * the wait ran out, the page gave up and put the picture back.
     *
     * Hiding the layers instead costs one frame, in both directions, and keeps
     * everything the engine has decoded, so the picture comes back without a
     * single request. What is deliberately *not* changed is which channels the
     * operator had switched off: they stay off when the picture comes back, so
     * this is a switch over the whole picture rather than a way of losing what
     * was set.
     */
    showPicture(on?: boolean) {
      own.showingPicture = on !== false;
      for (const row of own.rows) {
        if (!row.managed) continue;
        row.managed.setVisible(own.showingPicture && row.visible !== false);
      }
      syncCoverageVisibility(own);
    },

    /**
     * Change one channel: whether it shows, what colour it is drawn in, and the
     * brightness window applied to it.
     *
     * `index` counts across all the acquisitions in the order they are drawn,
     * which is the order they appear in a list on screen.
     */
    setChannel(index: number, { visible, colour, window: brightness, weight, gamma }: {
      visible?: boolean; colour?: number[]; window?: Span; weight?: number; gamma?: number;
    } = {}) {
      for (const row of own.rows.filter(one => one.controlIndex === index)) {
        if (!row.managed) continue;
        if (visible !== undefined) row.visible = visible;
        /* A channel switched on while the whole picture is off stays off on
           screen, and comes on with the picture. Without this the page could
           contradict itself: one channel drawn over a picture that is meant not to
           be there. */
        const shouldShow = own.showingPicture !== false && row.visible !== false;
        if (row.managed.visible !== shouldShow) {
          row.managed.setVisible(shouldShow);
        }
        syncCoverageVisibility(own);
        const layer = row.managed.layer;
        if (!layer) continue;
        if (colour) row.colour = colour;
        if (brightness) row.window = brightness;
        /* `weight` is the channel's own opacity, an extension the viewer's
           panel uses; an option without it simply ignores the key. */
        if (weight !== undefined) row.weight = weight;
        if (gamma !== undefined) row.gamma = gamma;
        if (colour || brightness || weight !== undefined || gamma !== undefined) {
          // Everything travels as values for controls the compiled program
          // declares — the colour included, so no change here recompiles.
          // Restored whole, never piecewise: a partial restore is how one
          // control quietly resets another to its default.
          layer.shaderControlState.restoreState(controlsFor(row));
        }
      }
    },

    /**
     * Every row's standing, for a measurement. What a test needs when
     * a layer is invisible and nothing on screen says why: whether the
     * engine holds it, what space it landed in, and where the view stands.
     */
    layersForMeasurement() {
      const space = own.viewer.navigationState.position.coordinateSpace.value;
      const channels = new Map<number | undefined, { sources: unknown[]; [more: string]: unknown }>();
      for (const row of own.rows) {
        const sources = Array.from<Engine>(row.managed?.layer?.dataSources ?? []).map((source, at) => {
          const landed = source?.loadState?.transform?.outputSpace?.value;
          return {
            url: row.sources?.[at] ?? null,
            matrix: source?.loadState?.transform?.value?.transform
              ? Array.from(source.loadState.transform.value.transform)
              : null,
            error: source?.loadState?.error?.message ?? null,
            dims: landed ? Array.from(landed.names) : null,
            scales: landed ? Array.from(landed.scales) : null,
            units: landed ? Array.from(landed.units) : null,
            lower: landed?.bounds ? Array.from(landed.bounds.lowerBounds) : null,
            upper: landed?.bounds ? Array.from(landed.bounds.upperBounds) : null,
            // Which convention the engine says this source counts in, per
            // axis: true means integer coordinates fall on voxel centres. Kept
            // for measurements only; the half-voxel correction no longer
            // trusts it, and this is how a record can show why.
            voxelCenterAtIntegerCoordinates: landed?.bounds?.voxelCenterAtIntegerCoordinates
              ? Array.from(landed.bounds.voxelCenterAtIntegerCoordinates)
              : null,
          };
        });
        const first = sources[0] ?? {};
        const held = channels.get(row.controlIndex);
        if (held) {
          held.sources.push(...sources);
          continue;
        }
        channels.set(row.controlIndex, {
          name: row.logicalName,
          visible: row.managed?.visible,
          window: row.window,
          weight: row.weight ?? 1,
          matrix: first.matrix ?? null,
          error: first.error ?? null,
          dims: first.dims ?? null,
          scales: first.scales ?? null,
          units: first.units ?? null,
          lower: first.lower ?? null,
          upper: first.upper ?? null,
          sources,
          navDims: Array.from(space?.names ?? []),
          nav: Array.from(own.viewer.navigationState.position.value ?? []),
        });
      }
      return [...channels].sort(([a], [b]) => (a ?? 0) - (b ?? 0)).map(([, row]) => row);
    },

    /** Close the viewer and let go of everything it was holding. */
    destroy() {
      if (own.destroyed) return;
      own.destroyed = true;
      own.watchSize?.disconnect();
      for (const stop of own.stopWatchingTheSources || []) stop();
      own.stopWatchingTheSources = null;
      for (const row of own.rows) {
        if (row.managed) deleteLayer(row.managed);
      }
      own.rows = [];
      for (const coverage of own.coverageLayers?.values() ?? []) deleteLayer(coverage.managed);
      own.coverageLayers?.clear();
      own.viewer?.dispose?.();
      own.viewer = null;
      own.engineHost.remove();
    },
  };
}
