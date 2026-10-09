/**
 * The run without presses: the steps from the focus map to the targets,
 * in turn, each awaited, over the whole scan area. Stops at the first
 * step that does not finish -- stopped by hand, failed, or not ready --
 * and leaves the steps after it as they were. Finishing writes the
 * protocol.
 *
 * This step does not run through the page's runner like the others: it is
 * the one that runs them. So its press calls `runProtocol` directly, and
 * `run.protocol` says whether it is running.
 */

import { protocolFrom } from "../../shared/protocol.js";
import { hasRecording } from "../../../../parts/microscope/recordings.js";

/* The steps the protocol walks, in order. */
const PROTOCOL_STEPS = ["focus", "scan", "detect", "gate", "select", "acquire"];

export async function runProtocol(page) {
  const state = page.run;
  const { step, indexOfStep } = page;
  if (state.running || state.protocol.running) return;
  /* Which steps the run will take: the focus map only when there is none
     measured on this sample yet; the gate is applied by the discovery. */
  const walk = PROTOCOL_STEPS.filter((id) => !(id === "focus" && state.focus.applied) && id !== "gate");
  state.protocol = {
    running: true, interrupted: false, at: 0, of: walk.length, within: null, summary: null,
  };
  state.failed = null;
  /* Grey until reached: the rail says what the run has done, not what
     the rehearsal did. Each step turns green as its own finish puts it
     back. */
  for (const id of [...walk, "gate", "protocol"]) { state.done.delete(id); state.stale.delete(id); }
  const startedAt = performance.now();
  let ended = "finished";
  for (const id of PROTOCOL_STEPS) {
    if (state.protocol.interrupted) { ended = "stopped"; break; }
    const i = indexOfStep(id);
    if (walk.includes(id)) { state.protocol.at += 1; state.protocol.within = null; }
    state.activeIdx = i;
    page.focusPanelsFor(i);
    page.renderAll();
    /* The gates are applied when the discovery finishes; here the step
       is only marked as the run's own. */
    if (id === "gate") {
      state.done.add("gate"); state.stale.delete("gate");
      continue;
    }
    /* A focus map already measured on this sample stands: the run keeps
       it and starts at the scan. Measured only when there is none yet,
       which is how a run opened on a protocol begins (Thom, 2026-09-28). */
    if (id === "focus" && state.focus.applied) {
      state.stale.delete("focus");
      continue;
    }
    const why = page.readiness(step(i));
    if (why) {
      state.notes[id] = why;
      ended = "failed";
      break;
    }
    const { outcome } = await page.runStep(i);
    if (outcome !== "finished") { ended = outcome; break; }
  }
  state.protocol.running = false;
  state.protocol.summary = {
    ended,
    tiles: state.scanned?.plan.length ?? 0,
    objects: state.cells.size,
    gated: state.gated.size,
    targets: state.acquired.length,
    seconds: (performance.now() - startedAt) / 1000,
    stoppedAt: ended === "finished" ? null : step(state.activeIdx).title,
    endedAt: performance.now(),
  };
  const at = indexOfStep("protocol");
  if (ended === "finished") {
    state.done.add("protocol"); state.ran.add("protocol"); state.stale.delete("protocol");
    try {
      await page.backend.saveProtocol?.(protocolFrom(state));
      state.notes.protocol = "run finished · protocol written";
    } catch (why) {
      state.notes.protocol = `run finished · protocol not written — ${why.message}`;
    }
  } else {
    state.notes.protocol = ended === "stopped"
      ? "stopped by hand" : `stopped at ${step(state.activeIdx).title} — ${state.notes[step(state.activeIdx).id] ?? "failed"}`;
  }
  state.activeIdx = at;
  state.sideMounted = null;
  page.focusPanelsFor(at);
  page.renderAll();
}

/** A step's own progress, handed to the protocol's bar while it runs. */
export function protocolWithin(page, done, of) {
  const state = page.run;
  if (!state.protocol.running) return;
  state.protocol.within = { done, of };
  page.renderProtocolProgress();
}

/* What would stop the protocol before it finished, said before it
   starts: the settings a later step needs and does not make for itself.
   The steps' own `ready` rules cannot be asked here for what an earlier
   step of the run produces (gated objects, target tiles), so this asks
   for the settings only. */
export function protocolBlockers(page) {
  const state = page.run;
  const blockers = [];
  const focus = page.step(page.indexOfStep("focus"));
  if (!state.focus.applied && focus.ready?.(state)) blockers.push(`Focus strategy: ${focus.ready(state)}`);
  if (!hasRecording(state.overviewPreset)) blockers.push("Overview scan area: import the optical configuration first");
  if (!state.plan.length) blockers.push("Overview scan area: nothing to scan yet");
  if (!state.gates.length) blockers.push("Discover Targets: draw a gate first");
  if (!hasRecording(state.targetType)) blockers.push("Target scan area: import the target settings first");
  if (state.targetFocusOn && !hasRecording(state.targetFocus)) blockers.push("Acquire Targets: import the focussing settings first");
  return blockers;
}

/** The operator's hand on the protocol run: the step in hand is braked
    where it can be, and the walk ends after it either way. */
export function interruptProtocol(page) {
  const state = page.run;
  state.protocol.interrupted = true;
  const s = page.step(state.activeIdx);
  if (state.running === s.id) { state.interrupting = s.id; s.brake?.(page); }
  page.renderActionBar();
}

/** After a run that finished, the burst can be brought back, at the right
    of the press (Thom, 2026-09-28). */
export function afterTheProtocolPress(host, page) {
  const state = page.run;
  if (state.protocol.summary?.ended === "finished" && state.protocol.playBurst) {
    const again = document.createElement("button");
    again.type = "button"; again.className = "run"; again.id = "protocol-again";
    again.textContent = "Rerun confetti";
    again.addEventListener("click", () => state.protocol.playBurst());
    host.append(again);
  }
}

/** Put the protocol's blockers where its `ready` rule can read them, on
    the run itself, so the rule needs no list of steps. */
export function installProtocol(page) {
  page.run.protocolBlockers = () => protocolBlockers(page);
  return {};
}
