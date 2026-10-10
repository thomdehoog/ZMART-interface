/**
 * Target acquisition's own verbs, pretended in the browser: the focus map,
 * the overview scan, finding and taking the targets, the plots and the
 * protocols, with timers and the pretend sample instead of a microscope.
 *
 * The general pretend verbs (connecting, the stage, settings, a capture)
 * are the shared rehearsal in `parts/microscope/mock.js`; these are this
 * workflow's, the pretend twin of `./live.js`. `flow.js` puts the two
 * together when the page's address asks for `?backend=pretend`, which only
 * this page's own browser tests do.
 *
 * Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
 * University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
 */

import { wait } from "../../../parts/microscope/mock.js";
import { makeRng } from "../../../parts/microscope/pretend-sample/rng.js";
import { METRIC_KEYS, sweep } from "../../../parts/microscope/pretend-sample/sweep.js";

const writtenProtocols = [];


/** How long a pretend tile test segments for: a moment a hand can reach. */
const TILE_TEST_MS = 1200;

/* The page's frames where there are frames, a timer where there are none:
   the contract suite runs this backend headless, and the pretend scan must
   tick there exactly as it ticks on screen. */
const frame = globalThis.requestAnimationFrame ?? ((tick) => setTimeout(tick, 16));

/* The pretend sample is not flat and not level: a gentle tilt across the
   carrier, the same surface wherever the plan decides to look at it. This is
   the mock's knowledge of the world — the page never computes it, it asks. */
const focusZAt = (x, y, [w, h]) =>
  -412 + 96 * (x / w - 0.5) + 61 * (y / h - 0.5);

/** Where on the sample a capture is, in the workflow's own label: the same
 *  five fields the bridge composes, so a run reads alike either way. */
const labelFor = (index, position = {}) => {
  const pad = (value, width) => String(value ?? 0).padStart(width, "0");
  return `K${pad(position.carrier, 2)}_M${pad(position.compartment, 6)}`
    + `_G${pad(position.group, 6)}_P${pad(index, 6)}_V${pad(position.view, 2)}`;
};

/* The positions each kind of scan was asked for, as the bridge keeps each
   scan's records: what discovery is over, once there has been an overview. */
const scanned = {};

/* The operator's hand on the brake, as the bridge keeps it: set by the stop
   verbs, read by the pretend runs between two fields. */
const stopAsked = { scan: false, focus: false, targets: false, acquire: false, plot: false };

/* Every object discovery found, by id: what a plot of every candidate is over. */
let discovered = [];

export const targetAcquisitionPretend = {
  /**
   * Drive to each point, focus there, and report what was found.
   *
   * Every measured point comes back with its height, plus everything the
   * window needs to show its work: the sweep traces for both sharpness
   * metrics (so the chart draws exactly what was measured), where the tissue
   * truly focuses, and the speck of debris the position carries, if any. A
   * height the operator moved by hand is kept — a measurement they overruled
   * is still their answer.
   *
   * `extent` is the carrier's size in micrometres; the pretend sample's tilt
   * is a fraction of the plate, so the mock needs to know how big the plate
   * is. The live backend ignores it — a real sample has its own tilt.
   */
  async measureFocus(points, { metric, extent, onPoint, state, beginAt } = {}) {
    void state; // the pretend instrument has no configuration to reapply
    stopAsked.focus = false;
    await wait(200);
    const measured = [];
    for (const [index, p] of points.entries()) {
      /* Between two points, as the bridge stops: what was measured stands.
         The gap is a yield, not a pause — long enough for a stop press to
         land between two points, and short enough that the rehearsal's pace
         stays the pace every budget in the specs was set to. */
      if (stopAsked.focus) return { points: measured, stopped: true };
      if (index) await wait(0);
      measured.push(measureOne(p, index));
      onPoint?.(measured[index], index);
    }
    return { points: measured, stopped: false };

    function measureOne(p, index) {
      const focusZ = focusZAt(p.x, p.y, extent);
      /* Where this search begins. The objective is driven there and swept about
         it, so running the map again from wherever the stage is standing is a
         different act from refining it against what the map already says: the
         second starts every search a micrometre or two from the tissue and the
         first has no idea. Said nothing, the objective arrives near the tissue
         by luck, which is the best a first run can claim. */
      const chosen = beginAt?.(index);
      const startZ = Number.isFinite(chosen) ? chosen
        : Number.isFinite(p.startZ) ? p.startZ : undefined;
      const traces = Object.fromEntries(METRIC_KEYS.map((key) => {
        const sw = sweep({ focusZ, index, metric: key, startZ });
        return [key, { samples: sw.samples }];
      }));
      /* What the point carried in is not what it carries out: `startZ` was an
         instruction for this run, and saying it back would have the next one
         begin where this one did. */
      const { startZ: began, ...was } = p;
      /* Reported as the live backend reports: the curves, and the tallest
         height in the deciding one. Which peak is the tissue is the page's
         rule, applied to every curve whoever measured it -- the mock used to
         choose for itself, so the live path chose differently and a speck of
         dust won a point unflagged. */
      const tallest = traces[metric].samples.reduce((a, q) => (q.s > a.s ? q : a));
      return { ...was, z: p.manual ? p.z : tallest.z, zAuto: tallest.z, lost: false, traces };
    }
  },

  /** The operator's Interrupt for the focus run, as the bridge offers it. */
  async stopFocusMeasure() {
    stopAsked.focus = true;
    return {};
  },

  /**
   * Drive the stage through every position, reporting progress as tiles land.
   *
   * The window's live picture is not fed from here: it watches the run's own
   * store and re-reads it as tiles are saved, which is the same arrangement
   * the real instrument has. This only says how far along the drive is.
   */
  async scanOverview({
    positions, acquisition_type = "overview", ms = 2600, onProgress, state,
    append = false, planned = null,
  } = {}) {
    void state;
    void append;
    void planned;
    stopAsked.scan = false;
    scanned[acquisition_type] = positions;
    const total = positions.length;
    const records = [];
    const started = performance.now();
    let stopped = false;
    await new Promise((resolve) => {
      const tick = () => {
        /* Between two fields, as the bridge stops: what landed stands. */
        if (stopAsked.scan) { stopped = true; resolve(); return; }
        const t = Math.min(1, (performance.now() - started) / ms);
        const done = Math.round(t * total);
        while (records.length < done) {
          const at = records.length;
          const p = positions[at];
          const stableAt = p.position_index ?? at;
          const path = `${acquisition_type}/${acquisition_type}_pretend_`
            + `${labelFor(stableAt, p)}_T000000_C00_Z00000.ome.tiff`;
          records.push({
            acquisition_type,
            position_label: labelFor(stableAt, p),
            /* One plane per record, saying where it was driven: a record
               with empty planes read fine against the page and undefined
               against anything that looked inside. */
            files: [path],
            planes: [{ t: 0, c: 0, z: 0, path, x_um: p.x, y_um: p.y, z_um: p.z ?? null }],
          });
        }
        const at = records[done - 1]?.planes[0];
        /* The records so far ride along, as the bridge's poll answers them. */
        onProgress?.(done, total, at ? { x: at.x_um, y: at.y_um, z: at.z_um } : null, records);
        if (t < 1) frame(tick);
        else resolve();
      };
      frame(tick);
    });
    /* The same shape the bridge answers with: a record for every position,
       so a page reading a finished run does not have to know which backend
       ran it. */
    return { done: records.length, of: total, records, stopped };
  },

  /** The operator's Interrupt for the scan, as the bridge offers it. */
  async stopScan() {
    stopAsked.scan = true;
    return {};
  },

  /**
   * Take the targets one tile at a time, as the bridge's page-driven run
   * does: a record a tile, in the scan's shape, with the height it was taken
   * at. With `focus` on, the tile is focussed first through the pretend
   * sweep, and the record says which height and why, as the live one does.
   */
  async acquireTargets({
    positions, state = null, append = false, focus = null, ms = 2600, onProgress, onDoing, zOffsetUm = 0,
} = {}) {
    void state;
    void append;
    stopAsked.acquire = false;
    scanned.targets = positions;
    const records = [];
    let stopped = false;
    for (const [index, p] of positions.entries()) {
      if (stopAsked.acquire) { stopped = true; break; }
      const say = (phase) => onDoing?.(`${phase} target ${index + 1} of ${positions.length}`);
      let z = p.z ?? null;
      let found = null;
      if (focus) {
        say("focussing on");
        const { points } = await this.measureFocus([{ x: (p.focusAt ?? p).x, y: (p.focusAt ?? p).y, startZ: z ?? undefined }],
          { metric: focus.metric, extent: focus.extent ?? [1, 1] });
        const [got] = points;
        found = { job: focus.state?.job ?? null, z_map_um: z, z_peak_um: got?.zAuto ?? null, found: Number.isFinite(got?.zAuto) };
        if (found.found) z = got.zAuto;
      }
      if (Number.isFinite(z)) z += zOffsetUm;
      say("imaging");
      await wait(Math.max(60, ms / Math.max(1, positions.length)));
      const stableAt = p.position_index ?? index;
      const path = `targets/targets_pretend_${labelFor(stableAt, p)}_T000000_C00_Z00000.ome.tiff`;
      records.push({
        acquisition_type: "targets",
        position_label: labelFor(stableAt, p),
        files: [path],
        planes: [{ t: 0, c: 0, z: 0, path, x_um: p.x, y_um: p.y, z_um: z }],
        requested_position_um: { x: p.x, y: p.y, z },
        taken: performance.now(),
        focus: found,
      });
      onProgress?.(records.length, positions.length, { x: p.x, y: p.y, z }, records);
    }
    onDoing?.(null);
    return { done: records.length, of: positions.length, records, stopped };
  },

  /**
   * A multidimensional plot, as the bridge answers one: two columns an
   * object by id, invented from the id so the same objects always land in
   * the same place. The objects are the ones discovery found.
   */
  /* Protocols kept for the page's lifetime, the way this backend keeps
     everything: written by a finished run, listed newest first. */
  async protocols() {
    return [...writtenProtocols].reverse();
  },
  async saveProtocol(protocol) {
    writtenProtocols.push({
      id: `target-acquisition_${(writtenProtocols.length + 1).toString(16).padStart(6, "0")}`,
      written: Date.now() / 1000,
      protocol: JSON.parse(JSON.stringify(protocol)),
    });
    return { written: writtenProtocols[writtenProtocols.length - 1].id };
  },
  async saveProtocolAs(protocol, name) {
    writtenProtocols.push({
      id: (name || `saved ${writtenProtocols.length + 1}`), written: Date.now() / 1000, saved: true,
      protocol: JSON.parse(JSON.stringify(protocol)),
    });
    return { written: name, id: name };
  },

  async computePlot({ kind, ids = null, onDoing } = {}) {
    stopAsked.plot = false;
    const over = ids ?? discovered;
    onDoing?.(`computing ${kind === "umap" ? "UMAP" : "principal components"} over ${over.length} objects`);
    await wait(kind === "umap" ? 600 : 150);
    onDoing?.(null);
    if (stopAsked.plot) return { stopped: true, columns: [] };
    const place = (id, salt) => makeRng([...String(id)].reduce((a, c) => a + c.charCodeAt(0), salt))() * 10 - 5;
    const columnsOf = (names, salt) => ({
      columns: names, ids: [...over], values: [over.map((id) => place(id, salt)), over.map((id) => place(id, salt + 1))],
    });
    const columns = [columnsOf(["pca_1", "pca_2"], 11)];
    if (kind === "umap") columns.push(columnsOf(["umap_1", "umap_2"], 23));
    return { stopped: false, objects: over.length, seconds: 0.1, columns };
  },

  /** The operator's Interrupt for a plot, as the bridge offers it. */
  async stopPlot() {
    stopAsked.plot = true;
    return {};
  },

  /** The operator's Interrupt for the target run, as the bridge offers it. */
  async stopAcquireTargets() {
    stopAsked.acquire = true;
    return { stopped: true };
  },

  /**
   * The targets in the overview's fields -- all of them, or the ones named --
   * each field's reaching `onField` as it is looked at. Invented: a handful of
   * cells per field, the same ones every time, laid inside the field the scan
   * was asked for. The settings are taken and ignored, because there are no
   * pixels here for a diameter to be right or wrong about.
   */
  async discoverTargets({
    fields = null, settings = {}, onField, onDoing, onProgress,
  } = {}) {
    void settings;
    stopAsked.targets = false;
    /* A tile test takes a moment, as the real one takes a minute: long
       enough that a hand can reach it, and the brake is honoured while it
       is being pretended. The whole-population run stays quick. */
    await wait(fields ? TILE_TEST_MS : 150);
    if (stopAsked.targets) return { fields: [], failed: [], stopped: true };
    const positions = scanned.overview ?? [];
    const found = (fields ?? positions.map((_, field) => field)).map((field) => {
      const at = positions[field];
      const r = makeRng(4400 + field);
      const frame = at.frameUm ?? 1000;
      const cells = Array.from({ length: 6 + Math.floor(r() * 10) }, (_, n) => {
        const area = 62 + 330 * Math.pow(r(), 1.7);
        return {
          id: `overview_r${String(field).padStart(3, "0")}_c000_obj${String(n + 1).padStart(5, "0")}`,
          field,
          x: at.x + (r() - 0.5) * frame,
          y: at.y + (r() - 0.5) * frame,
          area,
          intensity: 0.2 + 0.7 * r(),
          r: Math.sqrt(area / Math.PI),
        };
      });
      /* The device the field was detected on rides along, as the bridge's
         answer carries it; the pretend one has no card and says so. */
      return { field, position_label: labelFor(field, at), cells, device: "pretend" };
    });
    const gave = [];
    onProgress?.(0, found.length, { phase: "objects", objects: 0, running: true });
    for (const one of found) {
      if (stopAsked.targets) break;
      await wait(0);
      onDoing?.(`detecting and measuring objects in position ${one.field + 1}`);
      onField?.(one);
      gave.push(one);
      if (!fields) discovered = gave.flatMap((field) => field.cells.map((cell) => cell.id));
      onProgress?.(gave.length, found.length, {
        phase: "objects",
        objects: gave.reduce((sum, field) => sum + field.cells.length, 0),
        running: true,
      });
    }
    onDoing?.(null);
    return { fields: gave, failed: [], stopped: stopAsked.targets };
  },

  /** The operator's Interrupt for discovery, as the bridge offers it. */
  async stopTargets() {
    stopAsked.targets = true;
    return {};
  },
};
