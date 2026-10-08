/**
 * Step 10 — Run protocol.
 *
 * The run without presses. Every step above has been settled on this sample
 * and confirmed -- green -- and this one walks them in turn over the whole
 * scan area: the focus map measured when there is none on this sample yet,
 * the overview scanned, the objects detected, the gates applied, the scan
 * areas placed, the targets acquired. What it was told is written out at the
 * end as the protocol, the file the next sample's session is opened with.
 *
 * Its box holds this press and, after a run, the run's numbers. The press
 * is greyed while any step above stands orange: an orange step is one made
 * under settings that have since changed, and a run that started over it
 * would be a run over something nobody looked at. The step itself is never
 * orange -- it has no settings, it runs.
 *
 * `run.js` walks the steps; `channel.js` holds the box.
 */

import { protocolChannel } from "./channel.js";
import { afterTheProtocolPress, runProtocol } from "./run.js";

export const runProtocolStep = {
  id: "protocol",
  title: "Run protocol",
  why: "Runs the steps above in order over the whole scan area, keeping a focus map already measured, and writes the protocol.",
  btn: "Run protocol",
  panels: [],
  ms: 0,
  mode: "protocol",
  ready: (run) => {
    const stale = run.staleSteps?.() ?? [];
    if (stale.length) return `confirm ${stale.map((s) => s.title).join(", ")} first`;
    /* And what a later step would stop on: said now, not at step 8. */
    const blockers = run.protocolBlockers?.() ?? [];
    return blockers.length ? blockers[0] : null;
  },
  /* This step runs the others, so it is not run through the page like
     them: its press walks the steps itself, and it says for itself when
     it is running. */
  pressed: runProtocol,
  running: (run) => run.protocol.running,
  again: "Rerun protocol",
  afterThePress: afterTheProtocolPress,
  /* The protocol's box says what the run came to in its own line. */
  noHint: true,
  channel: protocolChannel,
};
