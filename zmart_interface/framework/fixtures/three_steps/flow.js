/**
 * Three steps -- a workflow that knows nothing about a microscope.
 *
 * This is the framework's own acceptance fixture: the smallest workflow that
 * exercises everything a workflow may declare, with no Python behind it and
 * no canvas. It stands under `framework/fixtures/` rather than under
 * `workflows/`, so the operator's chooser never offers it; the unit tests
 * assemble it the way the page assembles the real workflows, and the
 * installed-workflow test builds it into a package and installs it on a
 * bridge of its own, to prove a workflow written in another repository
 * plugs in without the page being rebuilt.
 *
 * It imports the framework by the bare name every installed workflow uses,
 * `zmart-interface/...`, never by a relative path: that is the point of it.
 *
 * What it does is deliberately dull. Begin is settled by standing on it;
 * Count to three runs for a moment, can be interrupted, and says what it
 * counted to; Finish runs at once and writes a note. Its one panel is a card
 * with a heading and a line of text that follows the run.
 */

import { sideGroup } from "zmart-interface/framework/window/panels.js";

export const blurb = "Three steps that know nothing about a microscope: begin, count to three, finish.";

/* The card: this workflow's one panel. The framework builds the box and
   this fills it -- a heading, a line that follows the run, and the foot the
   framework puts a step's press in (`foot-<key>`, as the action bar looks
   it up). */
const cardPanel = {
  key: "card",
  label: "Card",
  stays: true,
  build(host) {
    const box = document.createElement("div");
    box.className = "three-steps-card";
    const made = sideGroup("Three steps");
    const line = document.createElement("p");
    line.id = "three-steps-line";
    line.textContent = "Nothing counted yet.";
    made.body.append(line);
    box.append(made.group);
    const foot = document.createElement("div");
    foot.className = "panel-foot";
    foot.id = "foot-card";
    host.append(box, foot);
    return { foot, line };
  },
};

export const panels = [cardPanel];

/* Time passing, as the count waits for it. Short, so a test stays quick,
   and long enough for a press to land between two ticks. */
const tick = (ms) => new Promise((done) => setTimeout(done, ms));

const begin = {
  id: "begin",
  title: "Begin",
  why: "Standing on this step is all it asks.",
  panels: ["card"],
  settledByStanding(page) {
    page.run.done.add("begin");
    page.run.notes.begin = "begun";
  },
};

const countToThree = {
  id: "count",
  title: "Count to three",
  why: "Counts to three, one tick at a time, and can be stopped between two ticks.",
  btn: "Count",
  panels: ["card"],
  ms: 0,
  async run(page) {
    const state = page.run;
    state.counted = 0;
    state.stopAsked = false;
    for (let next = 1; next <= 3; next += 1) {
      await tick(400);
      if (state.stopAsked) return { stopped: true, note: `stopped at ${state.counted}` };
      state.counted = next;
      page.renderAll();
    }
    return undefined;
  },
  finished(page) {
    page.run.notes.count = "counted to 3";
  },
  brake(page) {
    page.run.stopAsked = true;
  },
};

const finish = {
  id: "finish",
  title: "Finish",
  why: "Ends the run with a word.",
  btn: "Finish",
  panels: ["card"],
  ms: 0,
  finished(page) {
    page.run.notes.finish = "finished";
  },
};

export const steps = [begin, countToThree, finish];

/** What a run of this workflow holds beside the framework's keys. */
export const freshState = () => ({ counted: 0, stopAsked: false });

/** Nothing of it outlives a change of workflow. */
export const keptAcrossSessions = [];

/** What a browser test may read of it. */
export const forTests = (state) => ({ counted: state.counted });

/** The card's line follows the run, on every render, while this workflow is open. */
export function install(page) {
  page.onRender.push(() => {
    const line = page.panels.card?.line;
    /* Only while this workflow is the open one: another workflow's render
       is not this card's business. */
    if (!line || !page.steps().some((s) => s.id === "count")) return;
    const state = page.run;
    line.textContent = state.done.has("finish") ? "Finished."
      : state.running === "count" ? `Counting: ${state.counted} so far.`
        : state.counted ? `Counted to ${state.counted}.` : "Nothing counted yet.";
  });
}
