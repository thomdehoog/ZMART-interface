/**
 * The run as the page keeps it: one document, written down once.
 *
 * Everything the operator has settled or measured lives in one plain object,
 * which every module reads and writes through `page.run`. This file is the
 * one place that says what a fresh run holds. It used to be written three
 * times -- once for the page opening, once for a disconnect and once for
 * opening on a protocol -- and the three copies disagreed in small ways
 * that nobody could see. Now `freshRun` is the one list, and the other two
 * moments copy the keys they need out of it.
 */

import { DEFAULT_SESSION } from "../../parts/microscope/instruments.js";
import { emptySlot } from "../../parts/microscope/recordings.js";
import { DEFAULT_CARRIER } from "../../workflows/target_acquisition/shared/carriers.js";
import { targetsDress, tilesDress } from "../../workflows/target_acquisition/shared/mask-layers.js";

/* The focus strategy is its own little document: which approach, that
   approach's parameters, and whatever it has produced so far.

   Only "plane" can be reached at the moment — the bar that chose between the
   four went, and comes back carrying whichever of them turns out to be
   wanted. The rest are parked rather than deleted: the model is what the step
   is about, and the readiness rules, the drawing and the trace all still ask
   which strategy this is. One row of markup arms them again. */
/* The focus maps a run holds, and which of them is being worked on.
   A map is a named thing the operator makes: where to measure, what was
   measured, and the surface fitted to it. Named on the way in, because a run
   may carry several — one per plate region, one measured before a long
   acquisition and reused after — and a list of unnamed ones is a list
   nobody can choose from. */
export function newFocus() {
  return {
    strategy: "plane",
    metric: "brenner",   // which sharpness score the sweep is scored with
    points: [],          // picked positions, plane strategy only
    perField: 1,         // how many Place lays in each tileset
    perCarrier: 4,       // and how many it lays over the whole carrier
    selected: 0,         // which point's trace is charted
    picked: new Set(),   // which are held, for moving or taking away together
    hovered: -1,         // which one the pointer has found, if any
    placing: false,      // whether the crosshair is armed for a press
    zFixed: -412,        // the fixed strategy's height, parked with it
    reuse: "run_0714_a", // the reuse strategy's choice, parked with it
    applied: false,
    surface: null,       // constant | plane | spline, chosen by geometry
    residual: null,
    worst: -1,
  };
}

// detection settings live next to the focus strategy: chosen, tried on one
// tile, then applied to the rest
export function newDetect() {
  return {
    algo: "fast",  // how objects are found: fast (watershed) | robust (Cellpose)
    diameter: 30,
    cellprob: 0,
    threshold: 100,  // fast only: a nucleus's mean above background, in counts
    border: 0,       // µm from the field's edge inside which a cell is dropped
    binning: 1,      // segment on a copy this many times smaller each side
    maskShow: "fill", // how the test view wears the masks: fill | line | off
    maskColour: null, // one colour for every object, or null for each its own
    maskAlpha: 0.65,  // how strongly the masks sit on the image (0..1)
    tile: 0,         // the current field of the plan: framed by Tile, tested
    targetTile: 0,   // the current target tile, on the steps about the targets
    hovered: -1,     // the tile under the pointer, a press from being tested
    tested: false,
    tried: [],
  };
}

/** The placing levers as a run starts, as `scan-areas.js` reads them. */
export const newPlacing = () => ({ margin: 1, objectsMax: 50, minimise: true, overlapMin: 0.2 });

/** The protocol run as it stands before one has been started. */
const newProtocol = () => ({
  running: false, interrupted: false, at: 0, of: 0, within: null, summary: null,
});

/**
 * A fresh run, for the workflow named and the backend it will speak to.
 *
 * Every key the page ever reads is here, with the value it has before the
 * operator has done anything, and a comment on what it means.
 */
export function freshRun({ workflow, backend }) {
  return {
    session: { ...DEFAULT_SESSION },
    /* What can be connected to, as the interface lists it (`/api/instruments`),
       grouped for the card: microscopes, each with its drivers. Loaded once
       the backend is known; empty until then. */
    instruments: [],
    overviewPreset: emptySlot("acquisition"),
    focusPreset: emptySlot("autofocus"),
    /* Read from further along the instrument's list than the overview: what
       the targets are taken with is a different setting from what found them,
       and a mock that answered with the same one twice would let a plan that
       never switched objectives look right. */
    targetType: emptySlot("acquisition", 1),
    /* Focussing before each target: off unless the operator asks, and then
       a focussing job of its own, read at the targets' magnification. */
    targetFocusOn: false,
    targetFocus: emptySlot("autofocus", 1),
    /* Added to every target's height on top of where it would be taken. */
    targetZOffsetUm: 0,
    /* How wide each acquired frame is on the sample, from the target
       recording; known once one has been taken or placed. */
    targetFrameUm: null,
    carrier: { ...DEFAULT_CARRIER },
    /* Points put on the carrier drawing, in the carrier's own coordinates, to
       be driven to on the microscope. Placed the way focus points are: the
       button arms, and the next press on the canvas puts one down. Which one
       is pressed, and which one the pointer rests on in the list. */
    anchors: [],
    anchoring: false,
    anchorPicked: -1,
    anchorLit: -1,
    /* The scan fields the operator drew, and the plan -- the positions the
       stage will visit -- worked out from them and the active preset. */
    fields: [],
    plan: [],
    /* The scan-field editor while its step is on screen, so it can be put
       away cleanly when the channel changes hands. */
    editor: null,
    /* The connection checks, one row per question the driver answers. */
    checks: [],
    wf: workflow,
    activeIdx: 0,
    done: new Set(),
    /* Done, but made under settings that have since changed above it:
       orange on the rail, asking to be confirmed or run again. A step is
       here only while it is also done. */
    stale: new Set(),
    /* Which steps have actually been run, as against settled by doing the
       thing they are about. Only a step that ran can be run *again*, and a
       button offering that on a step nobody has pressed is a button lying
       about what happened. */
    ran: new Set(),
    /* The step running now, the one being interrupted, and the one whose
       last run failed, each by id or null. */
    running: null,
    interrupting: null,
    failed: null,
    /* The protocol run -- Step 10 walking the steps in turn -- and the
       operator's Interrupt of it, latched so a step without a brake of its
       own ends the walk at its next look. */
    protocol: newProtocol(),
    /* The tiles the overview is rehearsed on: plan indices pressed green in
       Step 5. Empty means the whole plan. And how many the box offers to
       pick per tileset. */
    testTiles: new Set(),
    testN: 3,
    /* The protocols this machine has written, listed after connecting; the
       one this run was opened on, or null for a run from scratch; the
       sentence the Protocol box shows about it; and whether the steps after
       the focus map are still waiting to appear from the file. */
    protocols: [],
    protocolChosen: null,
    protocolNote: "",
    protocolPending: false,
    /* The plan as it was scanned -- the tiles sent, in the order sent -- and
       which plan index each was. Every result is read through this and not
       through `plan`, so a field's picture stays where it was taken when the
       plan is edited afterwards, and a scan of a few tiles numbers its
       fields the way the bridge does: by their place in what was sent. */
    scanned: null,
    /* What each step came to, by id: the sentence beside its press. */
    notes: {},
    tabs: [],             // worked out from the step, before anything is drawn
    tab: null,
    /* Which step's controls the channel holds now, so a step is mounted
       once rather than on every render. */
    sideMounted: null,
    tilesShown: 0,
    focus: newFocus(),
    /* A focus map apiece: the points measured under one focussing preset are
       not the points measured under another, and switching between them is
       switching between two maps rather than editing one. Kept by the
       recording's id, with `focusFor` saying whose map `focus` currently is. */
    focusMaps: {},
    focusFor: null,
    detect: newDetect(),
    /* What discovery found, by id, and the label of the field each came
       from, which is where its picture is. */
    cells: new Map(),
    fieldLabels: {},
    /* The fields the run's own discovery has examined: the masks the canvas
       shows are theirs alone, never a tile test's left on disk. */
    examined: new Set(),
    /* The mask layers detection has laid, one per picture it ran on: what
       the masks bar draws and whose dress the canvas wears. */
    masks: [],
    /* Where this backend serves the overview's and the targets' pictures,
       if anywhere. */
    overviewPictures: backend.viewOf?.("overview") ?? null,
    targetPictures: backend.viewOf?.("targets") ?? null,
    cellsShown: false,
    targetsDress: targetsDress(),
    /* Whether the column is folded away to the right, the canvas taking its
       room. A page preference too. */
    sideFolded: false,
    gates: [],           // [{fx, fy, vertices: [[x, y], ...]}] — see gating.js
    /* The selection as it stands: what the gates let through, and once
       Restrict has been pressed, that held under the ceiling. The canvas
       rings it and the targets scan images it. */
    gated: new Set(),
    /* What Restrict kept of it under the ceiling, and the tiles laid round
       those -- the plan the acquisition images. */
    restricted: new Set(),
    targetTiles: [],
    tilesDress: tilesDress(),
    /* The placing levers, as scan-areas.js reads them, and what the last
       placing came to. */
    placing: newPlacing(),
    tilePlan: null,
    acquired: [],
    /* The acquired target whose pair the gallery shows, chosen there or on
       the canvas; null until one is acquired. Whether that choice was the
       gallery's own quiet follow rather than the operator's. */
    selectedTarget: null,
    selectedQuietly: false,
    /* The acquired target under the pointer on the acquisition step: what a
       press would choose, outlined so the hand knows before it presses. */
    hoveredTarget: null,
    acquiredLabels: {},
    acquiredTiles: {},
  };
}

/* What survives a disconnect or a change of workflow: who the operator was
   talking to, and how the page was arranged. Everything else was read off
   the session or made against it, and goes with it. */
const KEPT_ACROSS_SESSIONS = new Set(["session", "instruments", "wf", "editor", "sideFolded"]);

/**
 * Put the run back to the beginning, keeping only what outlives a session.
 *
 * Closing the session takes the run with it: settings were read off this
 * microscope, the origin is in its coordinates, and the tiles came from it.
 * Keeping any of that against a session that has been closed would be
 * keeping something that might now be a lie. The chosen microscope, API and
 * password stay, since editing them is the reason to disconnect.
 */
export function startOver(state, backend) {
  const fresh = freshRun({ workflow: state.wf, backend });
  for (const key of Object.keys(fresh)) {
    if (!KEPT_ACROSS_SESSIONS.has(key)) state[key] = fresh[key];
  }
}

/* The settings a protocol carries, and the results that stand on them. A
   run opened on a protocol starts from these afresh and then fills them from
   the file; what the connection established stays. */
const THE_SETTINGS = [
  "overviewPreset", "focusPreset", "targetType", "targetFocusOn", "targetFocus", "targetZOffsetUm",
  "carrier", "anchors", "fields", "plan", "focus", "focusMaps", "focusFor", "detect",
  "gates", "gated", "placing", "testTiles", "stale", "protocolPending",
];

/**
 * Put the settings back to a fresh session's, before a protocol fills them
 * in or after the operator chose "new" again. The connection and what it
 * settled -- the connect step done, its note -- stay as they are.
 */
export function freshSettings(state, backend) {
  const fresh = freshRun({ workflow: state.wf, backend });
  for (const key of THE_SETTINGS) state[key] = fresh[key];
  state.notes = { connect: state.notes.connect };
  state.done = new Set(state.done.has("connect") ? ["connect"] : []);
  state.ran = new Set(state.ran.has("connect") ? ["connect"] : []);
}

/**
 * The run's own state, read-only, for a test that needs to say why a step
 * did nothing rather than only that it did. Left on the window, where a
 * browser test can ask for it.
 */
export function exposeTheRunForTests(state) {
  window.__theRunState = () => JSON.parse(JSON.stringify({
    running: state.running, failed: state.failed, notes: state.notes,
    activeIdx: state.activeIdx, done: [...state.done], ran: [...state.ran],
    stale: [...state.stale], protocol: state.protocol,
    testTiles: [...state.testTiles], scannedFields: state.scanned?.fields ?? null,
    focus: { strategy: state.focus.strategy, applied: state.focus.applied,
             points: state.focus.points.length, selected: state.focus.selected },
    /* How wide each acquired frame is, so a test can check the ground is
       opened over exactly the frame the recording describes. */
    targetFrameUm: state.targetFrameUm ?? null,
    targetFocusOn: state.targetFocusOn,
    /* What each acquired tile's record said about its focussing, keyed by
       tile, so a test can read which height a target was imaged at and why. */
    acquiredFocus: Object.fromEntries(Object.entries(state.acquiredTiles).map(
      ([key, one]) => [key, one.focus ?? null])),
    /* The chosen acquired tile key, so a test can press on the picture and
       see the choice land. */
    selectedTarget: state.selectedTarget ?? null,
    /* Whether that choice was the gallery's own, following the newest frame
       as a run grows, rather than the operator's. */
    selectedQuietly: state.selectedQuietly === true,
    acquiredTileKeys: [...state.acquired],
    restricted: [...state.restricted],
    targetTiles: state.targetTiles.length,
    targetTilePositions: state.targetTiles.map((tile) => ({
      x: tile.x, y: tile.y, frameUm: tile.frameUm,
      key: tile.key,
      overviewTileset: tile.overviewTileset,
      targetId: tile.targetId ?? tile.id,
      covers: tile.covers ?? [],
    })),
  }));
}
