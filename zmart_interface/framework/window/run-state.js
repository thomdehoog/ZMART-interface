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
 *
 * The document has two halves. The framework's half is here: which workflow
 * is open, which step is active, which steps are done, what is running, how
 * the page is arranged. The workflow's half is the workflow's own -- the
 * session, the carrier and the targets of a microscope run, or whatever an
 * e-learning or an analysis workflow keeps -- and the framework asks the
 * workflow for it rather than knowing it: a flow may export `freshState`,
 * `keptAcrossSessions` and `forTests`, written out in `workflows/README.md`,
 * and `freshRun` lays what `freshState` answers beside the keys below.
 */

/** The walk of the steps in turn, as it stands before one has been started.

    A step that runs the others -- target acquisition's Run protocol -- walks
    them through this: `running` while it does, `interrupted` once the
    operator's hand has asked it to stop after the step in hand, `at` of `of`
    for the bar, `within` for the step in hand's own progress, and `summary`
    for what the walk came to. The framework reads `running` to lock the
    rail, the press and the channel while the walk goes; the rest is the
    walking step's own. The key keeps the name it was given when the one
    such step was Run protocol. */
const newWalk = () => ({
  running: false, interrupted: false, at: 0, of: 0, within: null, summary: null,
});

/**
 * A fresh run, for the workflow named, the backend it will speak to, and the
 * flow that says what else a run of this workflow holds.
 *
 * The flow's own keys come first and the framework's after, so a workflow
 * that happens to name one of the framework's keys cannot overwrite it.
 * Every key the framework ever reads is here, with the value it has before
 * the operator has done anything, and a comment on what it means.
 */
export function freshRun({ workflow, backend, flow }) {
  return {
    ...(flow?.freshState?.({ backend }) ?? {}),
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
    /* The walk of the steps in turn -- a step that runs the others walking
       them -- and the operator's Interrupt of it, latched so a step without
       a brake of its own ends the walk at its next look. */
    protocol: newWalk(),
    /* What each step came to, by id: the sentence beside its press. */
    notes: {},
    tabs: [],             // worked out from the step, before anything is drawn
    tab: null,
    /* Which step's controls the channel holds now, so a step is mounted
       once rather than on every render. */
    sideMounted: null,
    /* An editor a step put in the channel while its step is on screen, so
       it can be put away cleanly when the channel changes hands. */
    editor: null,
    /* Whether the column is folded away to the right, the canvas taking its
       room. A page preference too. */
    sideFolded: false,
  };
}

/* What survives a disconnect or a change of workflow, of the framework's
   own keys: which workflow is open and how the page was arranged. The
   workflow names its own survivors in `keptAcrossSessions`. */
const KEPT_ACROSS_SESSIONS = ["wf", "editor", "sideFolded"];

/**
 * Put the run back to the beginning, keeping only what outlives a session.
 *
 * Closing the session takes the run with it: settings were read off this
 * microscope, the origin is in its coordinates, and the tiles came from it.
 * Keeping any of that against a session that has been closed would be
 * keeping something that might now be a lie. What does stay is what the
 * flow names -- for target acquisition the chosen microscope, API and
 * password, since editing them is the reason to disconnect -- and the
 * page's own arrangement.
 */
export function startOver(state, backend, flow) {
  const fresh = freshRun({ workflow: state.wf, backend, flow });
  const kept = new Set([...KEPT_ACROSS_SESSIONS, ...(flow?.keptAcrossSessions ?? [])]);
  for (const key of Object.keys(fresh)) {
    if (!kept.has(key)) state[key] = fresh[key];
  }
}

/**
 * The run's own state, read-only, for a test that needs to say why a step
 * did nothing rather than only that it did. Left on the window, where a
 * browser test can ask for it.
 *
 * The framework's fields come first; the workflow adds its own through the
 * flow's `forTests`. `flow` may be the flow itself or a function answering
 * the flow of the moment, since the operator can switch workflows after the
 * page has opened.
 */
export function exposeTheRunForTests(state, flow) {
  window.__theRunState = () => {
    const current = typeof flow === "function" ? flow() : flow;
    return JSON.parse(JSON.stringify({
      running: state.running, failed: state.failed, notes: state.notes,
      activeIdx: state.activeIdx, done: [...state.done], ran: [...state.ran],
      stale: [...state.stale], protocol: state.protocol,
      ...(current?.forTests?.(state) ?? {}),
    }));
  };
}
