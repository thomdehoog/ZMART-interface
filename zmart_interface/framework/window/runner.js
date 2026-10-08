/**
 * Running a step: the page's one lifecycle around every step's own work.
 *
 * A step says what it does in its `run(page, step, options)`; this file only
 * knows how a run begins and how it ends. It marks the step as running,
 * waits for the step's own promise, and then settles the run in one of three
 * ways: `finished`, `stopped` by the operator's hand, or `failed`. A step
 * with no `run` of its own finishes after the time its `ms` says, which is
 * the rehearsal's pace.
 *
 * What a step answers from `run`: nothing, for a run that finished; `{
 * stopped: true, note }` for one the operator put down, with the sentence
 * to say beside the press; or `{ failed: why }` for a failure the step has
 * already told the operator about in its own box. A run that throws is a
 * failure the page reports.
 *
 * Once a run finished, the step's `finished(page, step)` is called, which is
 * where a step files what it came to: its note, and whatever the next step
 * now has to work with.
 */

import { status } from "./status.js";
import { editedAt } from "../rules/steps.js";

/** Put the runner on the page: `runStep(i, options)`. */
export function installRunner(page) {
  const { run: state, steps, step } = page;

  /**
   * Runs the step and answers when it is over, with how: `finished`,
   * `stopped` by the operator's hand, or `failed`. What a press does when
   * pressed by hand, and what the protocol run awaits step by step.
   */
  function runStep(i, options = {}) {
    const s = step(i);
    if (state.running) return Promise.resolve({ outcome: "busy" });
    let settle;
    const outcome = new Promise((resolve) => { settle = resolve; });
    /* A fresh run is a fresh run. The failure of the last one was cleared
       only when a run finished -- which a failed connect never did -- so the
       next press re-checked everything and then refused to finish, leaving
       the old answers standing. The operator fixed autosave and the page went
       on saying it was off. */
    if (state.failed === s.id) state.failed = null;
    state.running = s.id;
    page.renderAll();

    /* The step's own work, or the rehearsal's timer for a step without any. */
    const work = s.run
      ? Promise.resolve().then(() => s.run(page, s, options))
      : new Promise((resolve) => setTimeout(resolve, s.ms));
    work.then((came) => {
      if (came?.failed) return putDown(came.failed);
      return came?.stopped ? stoppedShort(came.note) : finish();
    }, itFailed);
    return outcome;

    /** Finishing a step: done, green, and everything after it asked again. */
    async function finish() {
      /* A step that failed while running was already put down; finishing it
         anyway would mark a failed connection as a session. */
      if (state.failed === s.id) return;
      status.quiet();
      state.running = null;
      state.interrupting = null;
      state.done.add(s.id);
      state.ran.add(s.id);
      if (s.note) state.notes[s.id] = s.note;
      /* Run afresh, the step is green -- and everything after it was made
         from what it was before, so that goes orange. Not under the
         protocol, which makes every step afresh in turn. */
      state.stale.delete(s.id);
      if (!state.protocol.running) state.stale = editedAt(steps(), state.done, state.stale, s.id);
      /* What the step came to, filed by the step itself. */
      s.finished?.(page, s);
      /* Finishing a run never moves the operator. The gallery is still being
         curated, the trace still being read, and a step that quietly hands
         the page to the next one takes that away. Advancing is a click. */
      page.focusPanelsFor(state.activeIdx);
      page.renderAll();
      settle({ outcome: "finished", failed: state.notes[s.id]?.startsWith("finished —") ? 1 : 0 });
    }

    /** The operator's own Interrupt: not a failure, and not a finish either.
        What the run measured stands, and the step is done but orange: it did
        part of its work and asks to be confirmed as it is or run again. */
    function stoppedShort(note) {
      status.quiet();
      state.running = null;
      state.interrupting = null;
      state.done.add(s.id);
      state.stale.add(s.id);
      state.ran.add(s.id);
      state.notes[s.id] = note;
      page.focusPanelsFor(state.activeIdx);
      page.renderAll();
      settle({ outcome: "stopped" });
    }

    /** The step stops, marked as the failure it is, saying what went wrong. */
    function itFailed(why) {
      /* Said in the console too: the focus step draws no note, so a failure
         there had nowhere on screen to land and nobody could say why. */
      console.error(`${s.id} failed:`, why);
      status.quiet();
      state.notes[s.id] = `failed — ${why.message}`;
      putDown(why);
    }

    /** A failure the step has already shown where it happened: the step is
        put down without a note of the page's own. */
    function putDown(why) {
      state.failed = s.id;
      state.running = null;
      state.interrupting = null;
      page.renderAll();
      settle({ outcome: "failed", why });
    }
  }

  return { runStep };
}
