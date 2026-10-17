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

import type { TheRun, Walk } from "../types.ts";

/** What the run document asks of a workflow whose own keys are `S`: those keys, which survive, and what a test reads. */
interface RunFlow<S extends object = object> {
  freshState?(made: { backend: object }): S;
  keptAcrossSessions?: string[];
  forTests?(run: TheRun & S): Record<string, unknown>;
}

/**
 * The run as a browser test reads it: a plain copy of the framework's keys,
 * and whatever the open workflow's `forTests` adds beside them.
 */
export interface RunForTests {
  running: string | null;
  failed: string | null;
  notes: Record<string, string>;
  activeIdx: number;
  done: string[];
  ran: string[];
  stale: string[];
  walk: Walk;
  [more: string]: unknown;
}

declare global {
  interface Window {
    /** The run, read-only, for a browser test. */
    __theRunState?: () => RunForTests;
  }
}

/** The walk of the steps in turn, as it stands before one has been started.

    A step that walks the others -- target acquisition's Run protocol --
    sets `running` while it does, and the operator's Interrupt sets
    `interrupted` (`page.interruptWalk`), which the walking step reads to end
    after the step in hand. The framework reads `running` to lock the rail,
    the press and the channel while the walk goes. How far the walk has got,
    and what it came to, is the walking workflow's own. */
const newWalk = () => ({ running: false, interrupted: false });

/**
 * A fresh run, for the workflow named, the backend it will speak to, and the
 * flow that says what else a run of this workflow holds.
 *
 * The flow's own keys come first and the framework's after, so a workflow
 * that happens to name one of the framework's keys cannot overwrite it.
 * Every key the framework ever reads is here, with the value it has before
 * the operator has done anything, and a comment on what it means.
 */
export function freshRun<S extends object>({ workflow, backend, flow }: { workflow: string; backend: object; flow?: RunFlow<S> }): TheRun {
  return {
    ...(flow?.freshState?.({ backend }) ?? {}),
    wf: workflow,
    activeIdx: 0,
    done: new Set<string>(),
    /* Done, but made under settings that have since changed above it:
       orange on the rail, asking to be confirmed or run again. A step is
       here only while it is also done. */
    stale: new Set<string>(),
    /* Which steps have actually been run, as against settled by doing the
       thing they are about. Only a step that ran can be run *again*, and a
       button offering that on a step nobody has pressed is a button lying
       about what happened. */
    ran: new Set<string>(),
    /* The step running now, the one being interrupted, and the one whose
       last run failed, each by id or null. */
    running: null,
    interrupting: null,
    failed: null,
    /* The walk of the steps in turn -- a step that walks the others -- and
       the operator's Interrupt of it, latched so a step without a brake of
       its own ends the walk at its next look. */
    walk: newWalk(),
    /* What each step came to, by id: the sentence beside its press. */
    notes: {},
    tabs: [],             // worked out from the step, before anything is drawn
    tab: null,
    /* Which step's controls the channel holds now, so a step is mounted
       once rather than on every render. */
    sideMounted: null,
    /* Whether the column is folded away to the right, the canvas taking its
       room. A page preference too. */
    sideFolded: false,
  };
}

/* What survives a disconnect or a change of workflow, of the framework's
   own keys: which workflow is open and how the page was arranged. The
   workflow names its own survivors in `keptAcrossSessions`. */
const KEPT_ACROSS_SESSIONS = ["wf", "sideFolded"];

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
export function startOver<S extends object>(state: TheRun, backend: object, flow?: RunFlow<S>): void {
  const fresh: Record<string, unknown> = freshRun({ workflow: state.wf, backend, flow });
  const kept = new Set([...KEPT_ACROSS_SESSIONS, ...(flow?.keptAcrossSessions ?? [])]);
  for (const key of Object.keys(fresh)) {
    /* A kept key stays as it is -- unless it is not there at all, because
       another workflow was open in between and took it off the document;
       then it starts fresh like the rest. */
    if (!kept.has(key) || !(key in state)) (state as Record<string, unknown>)[key] = fresh[key];
  }
  /* What the previous workflow kept on the document and this one does not
     name goes too: a workflow chosen after a microscope run must not find
     that run's carrier and cells where it expected nothing. The document is
     plain data, so nothing on it is the page's to keep. */
  for (const key of Object.keys(state)) {
    if (!(key in fresh) && !kept.has(key)) delete (state as Record<string, unknown>)[key];
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
export function exposeTheRunForTests<S extends object>(state: TheRun, flow: RunFlow<S> | (() => RunFlow<S> | undefined)): void {
  window.__theRunState = () => {
    const current = typeof flow === "function" ? flow() : flow;
    return JSON.parse(JSON.stringify({
      running: state.running, failed: state.failed, notes: state.notes,
      activeIdx: state.activeIdx, done: [...state.done], ran: [...state.ran],
      stale: [...state.stale], walk: state.walk,
      /* The run is laid out by this workflow's `freshState`, so it holds its keys. */
      ...(current?.forTests?.(state as TheRun & S) ?? {}),
    }));
  };
}
