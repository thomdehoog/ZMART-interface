/**
 * Target acquisition's own verbs, over the bridge: the focus map, the
 * overview scan, finding and taking the targets, the plots and the
 * protocols.
 *
 * The general verbs every workflow uses -- connecting, the stage, the
 * instrument's settings, a capture, the pictures -- are the shared backend
 * in `parts/microscope/live.js`. These are this workflow's, and speak to its
 * own Python half on the bridge, under `/api/target_acquisition/`
 * (`../bridge/__init__.py`). `flow.js` puts the two together into the one
 * backend the steps call.
 *
 * Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
 * University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
 */

import { ask, askedPatiently, capturedBy, rest } from "../../../parts/microscope/live.js";
import { findCandidates, pickPeak } from "../../../parts/microscope/focus-peaks.js";

/* The operator's hand on the focus map and on the target run: read by each
   loop before its next drive. */
let targetsStopAsked = false;
let focusStopAsked = false;

export const targetAcquisition = {
  /**
   * Put one acquired target's frame on top of its neighbours in the
   * targets picture: the chosen one, whose pair the gallery shows.
   */
  async raiseTarget(position_label) {
    return ask("/api/target_acquisition/targets/raise", { position_label });
  },

  /**
   * Measure the focus map, one stack at a time, from here. Every command
   * is a question the bridge answers before the next is asked: drive to
   * the point, and the answer comes when the stage is there; take a stack,
   * and the answer is the record once the instrument has taken it; score
   * it, and the answer is the height with its curves. Between two answers
   * the page decides, and a stop is its own decision, made before the next
   * drive. The bridge runs nothing on its own; it keeps a ledger of the
   * points scored, for a page that reopens.
   *
   * `state` is the focussing recording, applied once before the run so
   * every stack is taken with the same job. A point whose drive or capture
   * fails is a LOST point, reported with no height, and the map goes on.
   *
   * `beginAt(index)`, when given, is asked just before each drive where that
   * point's search should begin. It is asked late on purpose: by then the
   * page has read the previous point, so a search can start at the height
   * just found there. A height it gives wins over the point's own `startZ`;
   * no answer leaves `startZ` as it was.
   */
  async measureFocus(points, { metric, state = null, onPoint, onDoing, beginAt } = {}) {
    void metric; // which curve decides is the page's rule, applied to what comes back
    focusStopAsked = false;
    if (state) await ask("/api/state", state);
    const { labels } = await ask("/api/target_acquisition/focus/begin", { of: points.length });
    const measured = [];
    let stopped = false;
    try {
      for (const [index, point] of points.entries()) {
        if (focusStopAsked) { stopped = true; break; }
        const say = (phase) => onDoing?.(`${phase} point ${index + 1} of ${points.length}`);
        /* `startZ` says where to begin this search; without one the stack
           is taken around the height the objective stands at. */
        const { startZ: given, ...asked } = point;
        const chosen = beginAt?.(index);
        const startZ = Number.isFinite(chosen) ? chosen : given;
        let landed;
        try {
          say("driving");
          const at = await ask("/api/xyz", {
            x: point.x, y: point.y, ...(Number.isFinite(startZ) ? { z: startZ } : {}),
          });
          say("capturing");
          const record = capturedBy(await ask("/api/acquire", {
            folder: "focussing", position_label: labels[index],
          }));
          say("scoring");
          landed = await ask("/api/target_acquisition/focus/score", { record, centre: at.z.position, point });
        } catch (why) {
          /* Cut off by the operator's own Interrupt (the bridge put the
             analysis down to reach a scoring that hung): not a point the
             microscope failed, just one not measured. */
          if (focusStopAsked) { stopped = true; break; }
          /* The microscope's own sentence rides on the point, so the row
             can say why: a move it declined is not a search that found no
             peak, and the window has no console to read it in. */
          landed = {
            ...asked, z: null, zAuto: null, lost: true, refused: why.message,
            traces: null, cost_s: {}, slices: [],
          };
        }
        measured.push(landed);
        onPoint?.(landed, index);
      }
    } finally {
      onDoing?.(null);
      await ask("/api/target_acquisition/focus/end", { stopped }).catch(() => {});
    }
    return { points: measured, stopped };
  },

  /** The operator's Interrupt for the focus run: the loop above stops before
      its next drive, and returns what was measured. The bridge is asked too,
      because a point whose scoring has hung never reaches "before its next
      drive"; its stop puts the analysis down, and that scoring answers. */
  async stopFocusMeasure() {
    focusStopAsked = true;
    await ask("/api/target_acquisition/focus/stop", {}).catch(() => {});
    return { stopped: true };
  },

  /**
   * Find the targets in the overview's fields -- all of them, or the ones
   * named in `fields` -- and follow the search as the scan is followed: the
   * bridge detects in a background thread, this polls, and each field's
   * targets reach `onField(field)` as they are found.
   */
  async discoverTargets({
    fields = null, settings = {}, onField, onDoing, onProgress,
  } = {}) {
    await ask("/api/target_acquisition/targets/discover", { fields, settings });
    /* The bridge lists fields in the order they land and keeps that order,
       so the fields held here are the cursor: each poll asks only for the
       ones landed since, and a run of hundreds of fields is not carried
       whole three times a second. */
    const landed = [];
    for (;;) {
      const progress = await askedPatiently(`/api/target_acquisition/targets/discover?since=${landed.length}`);
      onDoing?.(progress.running ? progress.doing : null);
      onProgress?.(progress.done, progress.of, {
        phase: progress.phase,
        objects: progress.objects ?? 0,
        running: !!progress.running,
      });
      for (const one of progress.fields ?? []) {
        landed.push(one);
        onField?.(one);
      }
      if (progress.error) throw new Error(progress.error);
      if (!progress.running) {
        return {
          fields: landed,
          failed: progress.failed ?? [],
          stopped: !!progress.stopped,
        };
      }
      await rest(300);
    }
  },

  /** The operator's Interrupt for discovery: the bridge stops the search --
      putting the field in hand down with it, because an analysis field
      re-runs from its checkpoint -- and the poll above ends with what was
      found. */
  async stopTargets() {
    return ask("/api/target_acquisition/targets/discover/stop", {});
  },

  /**
   * Start the overview scan and follow it by asking, not by being told: the
   * bridge drives the stage in a background thread, and this polls its
   * progress until the drive is over. The window's live picture watches the
   * run's own store, exactly as it does on the pretend side.
   */
  async scanOverview({
    positions, acquisition_type = "overview", state = null, onProgress,
    append = false, planned = null,
  } = {}) {
    await ask("/api/target_acquisition/scan", { positions, acquisition_type, state, append, planned });
    /* The records so far, kept here: each poll asks only for the ones that
       landed since, so a long scan is not carried whole three times a second. */
    const records = [];
    for (;;) {
      const progress = await askedPatiently(`/api/target_acquisition/scan?since=${records.length}`);
      records.push(...(progress.records ?? []));
      /* Where the scan stood when it answered -- the last record's own plane,
         which is the only account of the stage that is already in hand. */
      const plane = records[progress.done - 1]?.planes?.[0];
      /* The records so far ride along: each one names the picture the bridge
         has already made of it, so the page can print a field the moment it
         lands rather than when the run answers. */
      onProgress?.(progress.done, progress.of,
        plane ? { x: plane.x_um, y: plane.y_um, z: plane.z_um } : null, records);
      if (progress.error) throw new Error(progress.error);
      if (!progress.running) {
        /* The records come back with the run: what each capture wrote and
           where. Nothing else can reconstruct them, so a run that ended
           without them is a run nobody can account for. `stopped` rides
           along -- the operator's own hand is not a failure. */
        return { done: progress.done, of: progress.of, records, stopped: !!progress.stopped };
      }
      await rest(300);
    }
  },

  /** The operator's Interrupt for the scan: the bridge stops between two
      fields, and the poll above ends with what was captured. */
  async stopScan() {
    return ask("/api/target_acquisition/scan/stop", {});
  },

  /**
   * Take the targets, one tile at a time, from here -- the focus map's
   * shape: every command is a question the bridge answers before the next
   * is asked, the page decides between two answers, and a stop is its own
   * decision, made before the next drive. The bridge runs nothing on its
   * own; it files each landed target and keeps a ledger for a page that
   * reopens.
   *
   * `state` is the target acquisition recording, `focus` the focussing the
   * operator asked for before each target -- `{state, metric}`, its own
   * recording and the sharpness score that decides -- or null. With it, a
   * tile is driven to at the map's height, a stack taken under the
   * focussing job, the peak chosen here by the map's own rule, and the
   * target taken at that height under the target job. A stack with no peak
   * leaves the target at the map's height, and the record says so.
   */
  async acquireTargets({
    positions, state = null, append = false, focus = null, zOffsetUm = 0, onProgress, onDoing,
  } = {}) {
    targetsStopAsked = false;
    const { labels } = await ask("/api/target_acquisition/targets/acquire/begin", { positions, append });
    if (!focus && state) await ask("/api/state", state);
    const records = [];
    let stopped = false;
    try {
      for (const [index, position] of positions.entries()) {
        if (targetsStopAsked) { stopped = true; break; }
        const say = (phase) => onDoing?.(`${phase} target ${index + 1} of ${positions.length}`);
        const { x, y, z: zMap = null, focusAt = null } = position;
        /* The operator's offset rides on whatever height is chosen below:
           the map's, the peak's, or where the objective stood. */
        const lifted = (z) => z + zOffsetUm;
        let at = { x, y, ...(Number.isFinite(zMap) ? { z: lifted(zMap) } : {}) };
        /* The stack is taken on the object's centre when the page names it,
           which need not be the middle of the tile imaged after it. */
        const focusXY = focusAt ?? { x, y };
        const focusMoves = focusXY.x !== x || focusXY.y !== y;
        let found = null;
        /* Where the objective stood for the stack: the height the target is
           taken at when the stack shows no peak, map or no map. */
        let standing = null;
        if (focus) {
          say("focussing on");
          if (focus.state) await ask("/api/state", focus.state);
          /* The stack is taken at the map's own height, without the offset:
             the offset is for the target, and is added once to the height
             chosen from the stack. Taken at the lifted height, a stack with
             no peak lifted the target a second time. */
          const stood = await ask("/api/xyz", {
            x: focusXY.x, y: focusXY.y, ...(Number.isFinite(zMap) ? { z: zMap } : {}),
          });
          standing = stood.z.position;
          const stack = capturedBy(await ask("/api/acquire", {
            folder: "target-focussing", position_label: labels[index], acquisition_settings: null,
          }));
          const scored = await ask("/api/target_acquisition/targets/acquire/focus", {
            record: stack, centre: standing, x: focusXY.x, y: focusXY.y,
          });
          const curve = scored.traces?.[focus.metric];
          const peak = curve?.samples?.length ? pickPeak(findCandidates(curve.samples)) : null;
          found = {
            job: focus.state?.job ?? null, z_map_um: Number.isFinite(zMap) ? zMap : null,
            z_peak_um: peak ? peak.z : null, found: peak !== null,
          };
          if (peak) at = { x, y, z: lifted(peak.z) };
          else if (Number.isFinite(standing)) at = { x, y, z: lifted(standing) };
          if (state) await ask("/api/state", state);
        }
        say("imaging");
        /* Already standing there after a stack with no peak: no second drive. */
        const stood = focus && !found.found && !focusMoves && !zOffsetUm
          ? { z: { position: standing } } : await ask("/api/xyz", at);
        const record = capturedBy(await ask("/api/acquire", {
          folder: "targets", position_label: labels[index], acquisition_settings: null,
        }));
        const landed = await ask("/api/target_acquisition/targets/acquire/landed", {
          record, position: { x, y, z: stood.z.position }, focus: found,
        });
        records.push(landed);
        onProgress?.(records.length, positions.length, { x, y, z: stood.z.position }, records);
      }
    } finally {
      onDoing?.(null);
      await ask("/api/target_acquisition/targets/acquire/end", { stopped }).catch(() => {});
    }
    return { done: records.length, of: positions.length, records, stopped };
  },

  /**
   * The protocols written under this session's output root, newest first,
   * each with its settings inline: the list is short and the files small,
   * so there is nothing to fetch a second time.
   */
  async protocols(instrument = null) {
    const { protocols } = await ask("/api/target_acquisition/protocols", instrument ? { instrument } : undefined);
    return protocols ?? [];
  },

  /** The run's settings, written as `protocol.json` into the run folder. */
  async saveProtocol(protocol) {
    return ask("/api/target_acquisition/protocol", { protocol });
  },

  /** The settings saved by name into this machine's library, under ProgramData. */
  async saveProtocolAs(protocol, name) {
    return ask("/api/target_acquisition/protocol/save", { protocol, name });
  },

  /**
   * A multidimensional plot of the detected population -- `pca` or `umap`
   * -- over the objects named by `ids`, or every candidate when left out.
   * The bridge runs it through the analysis and this follows it until it
   * lands; then every plot it wrote comes back as columns by id
   * (`{columns, ids, values}`), a UMAP bringing the components it stood on.
   */
  async computePlot({ kind, ids = null, onDoing } = {}) {
    await ask("/api/target_acquisition/plots/compute", { kind, ids });
    for (;;) {
      const progress = await askedPatiently("/api/target_acquisition/plots/compute");
      onDoing?.(progress.running ? progress.doing : null);
      if (!progress.running) {
        if (progress.error) throw new Error(progress.error);
        if (progress.stopped) return { stopped: true, columns: [] };
        const columns = [];
        for (const one of progress.kinds ?? []) {
          columns.push(await ask(`/api/target_acquisition/plots/columns?kind=${encodeURIComponent(one)}`));
        }
        return { stopped: false, objects: progress.objects, seconds: progress.took_s, columns };
      }
      await rest(500);
    }
  },

  /** The operator's Interrupt for a plot: the bridge puts its worker down. */
  async stopPlot() {
    return ask("/api/target_acquisition/plots/compute/stop", {});
  },

  /** The operator's Interrupt for the target run: the loop above stops
      before its next drive, and returns what was taken. */
  async stopAcquireTargets() {
    targetsStopAsked = true;
    return { stopped: true };
  },
};
