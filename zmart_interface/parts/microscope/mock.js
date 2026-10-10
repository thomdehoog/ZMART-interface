/**
 * The seam where the microscope goes — the pretend side of it.
 *
 * Everything above this line — steps, widgets, the framework — talks to a backend
 * and awaits. Nothing above this line knows whether a real stage moved. The
 * live backend (`live.js`, speaking HTTP to the bridge and through it to the
 * zmart controller) implements this same shape; if wiring the real microscope
 * means editing a widget, the seam leaked.
 *
 * This backend fakes the work with timers and the pretend sample, so the page
 * can be developed and tested with no instrument anywhere near it.
 *
 * The verbs, and the two kinds they come in
 * -----------------------------------------
 *
 * **Readouts** ask the instrument how it is set and change nothing.
 * `readSetting` is the whole of recording a preset — the acquisition settings
 * and the focussing preset alike are the instrument's state, read now. On the
 * live side this is one `get_state` through the controller.
 *
 * **Procedures** make the instrument do something. `connect` opens the
 * session, `measureFocus` drives to each point and focuses there,
 * `scanOverview` drives the whole plan. On the live side these move a real
 * stage, which is why they are separate verbs and not part of any readout.
 *
 * `discoverTargets` finds the targets in the scanned fields; on the live side
 * that is the analysis reading the overview's pixels, and here it is invented
 * from the fields the scan was asked for. Acquiring the targets is
 * `scanOverview` again, with the targets as the positions.
 */

import { MICROSCOPES, THE_MOCK } from "./instruments.js";
import { sampleReading } from "./settings.js";
import { makeRng } from "./pretend-sample/rng.js";
import { METRICS, METRIC_KEYS } from "./pretend-sample/sweep.js";

/** A pause, for the pretend instrument's timers; lent to the workflows' own pretend verbs. */
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const backend = {
  /**
   * No pictures: this backend acquires nothing, so there is nothing to fetch.
   *
   * `null` rather than an address that would 404, because the canvas asks this
   * to decide whether to fetch an engine at all — a large thing to load for a
   * scan that does not exist.
   */
  viewOf() {
    return null;
  },

  /** No viewer server on the pretend side; the page draws its rehearsal. */
  async viewerSources() {
    return null;
  },

  /** What can be connected to: the interface's list of microscopes, as the bridge gives it. */
  async instruments() {
    return pretendInstruments();
  },

  /**
   * Open the session and verify it, one named check at a time.
   *
   * The keys arrive first through `onChecks`, so the window can put every
   * question on screen before any answer exists; each answer then lands
   * through `onCheck(index, value)` as the pretend verification gets to it.
   * Resolves, with the instrument's info, once every check has answered.
   */
  async disconnect() {},

  async connect(session, { onChecks, onCheck } = {}) {
    const status = pretendConnectionStatus(session);
    const keys = Object.keys(status);
    onChecks?.(keys);
    await Promise.all(keys.map((key, k) =>
      wait(260 * (k + 1)).then(() => onCheck?.(k, status[key]))));
    return { info: await this.info() };
  },

  /** The instrument's account of itself: nothing the page reads. Where the
   *  stage goes and how far its pictures reach are `get_xyz`'s to say. */
  async info() {
    return {};
  },

  /** Where the stage is, per axis in micrometres: the controller's `get_xyz`. */
  async get_xyz() {
    return standingAt(where);
  },

  /**
   * Drive the stage there: the controller's `set_xyz`, answered with where it
   * ended up.
   *
   * The pretend stage moves, and that matters. It stood at one spot before,
   * which made every reading of it identical and hid a whole class of fault —
   * a page that never sees the position change is a page nobody can catch
   * drawing the mark in the wrong place. A move past the end of its travel
   * is refused before anything moves, the way a real driver refuses it, and
   * the stage stays where it was.
   */
  async set_xyz({ x, y, z }) {
    await wait(220);
    const to = { x: x ?? where.x, y: y ?? where.y, z: z ?? where.z };
    for (const axis of ["x", "y", "z"]) {
      const [low, high] = TRAVEL_RANGE_UM[axis];
      if (to[axis] < low || to[axis] > high) {
        throw new Error(`${axis} = ${to[axis]} um is outside the stage's travel [${low}, ${high}] um`);
      }
    }
    where = to;
    return standingAt(where);
  },

  /**
   * What this pretend instrument offers for a capture, and what is chosen now.
   *
   * The controller's mock driver's own menu, said the same way — so the page
   * meets the same shape here as it does through the bridge, and cannot come
   * to rely on a setting only one of them has.
   */
  async get_acquisition_settings() {
    await wait(120);
    return {
      folder: { options: "any text; empty saves straight into output_root", active: "" },
      job: { options: [...JOBS], active: chosenJob },
      backlash_correction: { options: [true, false], active: true },
      format: { options: ["ome-tiff", "ome-zarr"], active: "ome-tiff" },
      procedure: { options: ["direct", "tiled"], active: "direct" },
    };
  },

  /**
   * Change a setting on this pretend instrument, and answer with what stuck.
   *
   * A job it does not have is refused rather than accepted quietly: a capture
   * taken with one would not run, and a page is better told now than at the
   * press. The controller's mock driver refuses the same way.
   *
   * Nothing on the page calls this, by decision. A chooser would be named
   * after one vendor's noun — `job` is LAS X's word, and another instrument
   * has a protocol or an experiment or nothing like it — so the page would
   * have learned one microscope. It is here because the seam mirrors the
   * controller's surface, not this one page's needs.
   */
  async set_state(settings) {
    await wait(160);
    const applied = {};
    if ("job" in settings) {
      if (!JOBS.includes(settings.job)) {
        throw new Error(`unknown job '${settings.job}'; have ${JOBS.join(", ")}`);
      }
      chosenJob = settings.job;
      applied.job = chosenJob;
    }
    return { applied };
  },

  /**
   * A readout, never a procedure: the instrument's state as it is set now,
   * shaped as the reading the window records. Recording a preset is this and
   * nothing more — nothing on the instrument moves.
   *
   * `nth` is the pretend operator's doing: the mock answers with the nth state
   * it knows, as though the optics were changed between readings. The live
   * backend reads what is there and ignores it.
   */
  async readSetting(type, { nth = 0 } = {}) {
    await wait(480);
    return sampleReading(type, nth);
  },

  /**
   * Capture once where the stage is standing, answering as the controller
   * does: `{success, content}`, the content holding `files` and `planes`.
   *
   * `folder` is the page's name for the acquisition the capture belongs to;
   * like the bridge, this pretend instrument takes it as its `folder`
   * acquisition setting, which is where the files would go.
   *
   * The names are the convention's, flat and complete: which folder it was
   * asked into, which capture it was, where on the sample, and which plane of it — so
   * nothing has to be opened to know what it holds. A browser writes no
   * files, so these are paths the rehearsal names and does not make; through
   * the bridge the same names are files on disk.
   */
  async acquire({ position_label, acquisition_settings = null, folder = null }) {
    await wait(240);
    const hash6 = makeRng(where.x + where.y + captures++)()
      .toString(36).slice(2, 8).padEnd(6, "0");
    const into = acquisition_settings?.folder ?? folder ?? "";
    const path = (into ? `${into}/${into}_` : "") + `${hash6}_`
      + `${position_label}_T000000_C00_Z00000.ome.tiff`;
    return {
      success: true,
      content: {
        acquisition_hash: hash6,
        position_label,
        folder: into,
        format: acquisition_settings?.format ?? "ome-tiff",
        position: { ...where },
        files: [path],
        /* Where each plane was taken travels with it, as the real record's
           planes do: the record is the only thing that knows. */
        planes: [{ t: 0, z: 0, c: 0, path, x_um: where.x, y_um: where.y, z_um: where.z }],
      },
    };
  },


};

/* What METRICS looks like is display metadata the window shares (labels,
   colours); re-exported so the page reads it through the seam rather than
   reaching into the pretend sample. */
export { METRICS, METRIC_KEYS };

/* A deterministic random stream for the window's rehearsal drawings (the
   pretend image textures in previews). Re-exported for the same reason. */
export { makeRng };


/* ==========================================================================
   what this pretend instrument answers about itself
   ========================================================================== */

/** How far this pretend stage travels, in micrometres. */
const TRAVEL_UM = { x: 120_000, y: 80_000 };

/** The list a microscope PC with the Leica installed as "stellaris" would
 *  offer: the interface's mock first, then the controller's list. */
export const pretendInstruments = () => [THE_MOCK, "mock", "stellaris"];

export const pretendConnectionStatus = ({ instrument }) => ({
  "Microscope reachable": MICROSCOPES[instrument] ? "in-process" : "127.0.0.1:8895",
  "Credentials accepted": "token valid",
  "API version": MICROSCOPES[instrument]?.apiDetail ?? "LAS X 4.9",
  "Stage responds": "x 0.0 · y 0.0 · z −412.0 µm",
  "Objectives listed": "5x, 63x",
  "Storage writable": "smart/organoid-screen_a7f3c1/",
});

/** How far each axis travels, `[min, max]` in micrometres. Its pictures are
 *  named, never drawn, so they show no further than the stage goes: the
 *  `canvas` `get_xyz` reports is the travel itself. */
const TRAVEL_RANGE_UM = { x: [0, TRAVEL_UM.x], y: [0, TRAVEL_UM.y], z: [-2_000, 2_000] };


/* How many captures this instrument has taken, so two at one place still get
   names of their own — which is what the hash is for on a real one. */
let captures = 0;




/* The jobs this pretend instrument has stored, and which is chosen. The same
   three the controller's mock driver keeps, so the page meets one instrument
   whichever backend it is talking to. */
const JOBS = ["Overview", "Focussing", "Target", "Target focussing"];
let chosenJob = JOBS[0];

/** Where its stage is parked before anything has driven it: the corner, off
 *  the carrier. */
const pretendPositionUm = () => ({ x: TRAVEL_UM.x * 0.04, y: TRAVEL_UM.y * 0.04, z: -412 });

/* Where it is standing now. The one piece of state this pretend instrument
   keeps between calls, because a stage is the one part of a microscope that
   stays where it was put. */
let where = pretendPositionUm();

/** A position, shaped the way the controller reports one: each axis gives
    its position in micrometres from the origin, the unit, every motor of the
    axis with its own raw reading, and the canvas. The pretend stage has one
    motor per axis, and it reads what the axis reads. */
const standingAt = (at) => Object.fromEntries(["x", "y", "z"].map((axis) => [axis, {
  position: at[axis], unit: "micrometer", actuators: { motoric: at[axis] },
  canvas: [...TRAVEL_RANGE_UM[axis]],
}]));
