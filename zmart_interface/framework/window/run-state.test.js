/* The run document, in two halves: the framework's keys, and whatever the
   workflow says a run of it holds. The framework must be able to make, reset
   and expose a run for a workflow that knows nothing about a microscope --
   the fixture under `framework/fixtures/three_steps/` -- and carry none of
   target acquisition's keys while doing so. */

import { describe, it, expect, afterEach } from "vitest";
import { exposeTheRunForTests, freshRun, startOver } from "./run-state.js";
import * as threeSteps from "../fixtures/three_steps/flow.js";
import * as targetAcquisition from "../../workflows/target_acquisition/flow.js";

const NO_BACKEND = Object.freeze({});

/* The framework's own keys, written out: what every run has whatever its
   workflow. A new key the framework reads belongs in this list. */
const THE_FRAMEWORKS_KEYS = [
  "wf", "activeIdx", "done", "stale", "ran", "running", "interrupting", "failed",
  "protocol", "notes", "tabs", "tab", "sideMounted", "editor", "sideFolded",
];

/* A few of target acquisition's, as the keys a run of another workflow must
   not have. */
const A_MICROSCOPES_KEYS = ["session", "instruments", "carrier", "focus", "plan", "cells", "acquired"];

describe("a fresh run", () => {
  it("holds the framework's keys and the fixture's, and none of a microscope's", () => {
    const run = freshRun({ workflow: "three_steps", backend: NO_BACKEND, flow: threeSteps });
    for (const key of THE_FRAMEWORKS_KEYS) expect(run, key).toHaveProperty(key);
    expect(run.counted).toBe(0);
    expect(run.stopAsked).toBe(false);
    for (const key of A_MICROSCOPES_KEYS) expect(run, key).not.toHaveProperty(key);
    expect(run.wf).toBe("three_steps");
    expect(run.protocol.running).toBe(false);
  });

  it("holds only the framework's keys for a flow with no state of its own", () => {
    const run = freshRun({ workflow: "plain", backend: NO_BACKEND, flow: { steps: [] } });
    expect(Object.keys(run).sort()).toEqual([...THE_FRAMEWORKS_KEYS].sort());
  });

  it("holds target acquisition's keys when that is the workflow", () => {
    const run = freshRun({ workflow: "target_acquisition", backend: NO_BACKEND, flow: targetAcquisition });
    for (const key of [...THE_FRAMEWORKS_KEYS, ...A_MICROSCOPES_KEYS]) expect(run, key).toHaveProperty(key);
  });

  it("never lets a workflow overwrite one of the framework's keys", () => {
    const greedy = { freshState: () => ({ done: "mine", counted: 1 }) };
    const run = freshRun({ workflow: "greedy", backend: NO_BACKEND, flow: greedy });
    expect(run.done).toBeInstanceOf(Set);
    expect(run.counted).toBe(1);
  });
});

describe("starting over", () => {
  it("keeps the workflow and the page's arrangement, and what the flow names", () => {
    const flow = { ...threeSteps, keptAcrossSessions: ["counted"] };
    const run = freshRun({ workflow: "three_steps", backend: NO_BACKEND, flow });
    run.counted = 3; run.stopAsked = true; run.sideFolded = true; run.editor = "an editor";
    run.done.add("begin"); run.activeIdx = 2; run.notes.count = "counted to 3";
    startOver(run, NO_BACKEND, flow);
    expect(run.wf).toBe("three_steps");
    expect(run.sideFolded).toBe(true);
    expect(run.editor).toBe("an editor");
    expect(run.counted).toBe(3);
    expect(run.stopAsked).toBe(false);
    expect(run.done.size).toBe(0);
    expect(run.activeIdx).toBe(0);
    expect(run.notes).toEqual({});
  });

  it("puts everything the flow does not name back to fresh", () => {
    const run = freshRun({ workflow: "three_steps", backend: NO_BACKEND, flow: threeSteps });
    run.counted = 2;
    startOver(run, NO_BACKEND, threeSteps);
    expect(run.counted).toBe(0);
  });

  it("takes the previous workflow's keys off the document when another is chosen", () => {
    const run = freshRun({ workflow: "target_acquisition", backend: NO_BACKEND, flow: targetAcquisition });
    run.carrier.kind = "slide"; run.cells.set(1, {});
    run.staleSteps = () => [];
    run.wf = "three_steps";
    startOver(run, NO_BACKEND, threeSteps);
    for (const key of A_MICROSCOPES_KEYS) expect(run, key).not.toHaveProperty(key);
    expect(run.counted).toBe(0);
    /* What the page attached stays: it is the page's, not a workflow's. */
    expect(typeof run.staleSteps).toBe("function");
    expect(run.wf).toBe("three_steps");
  });

  it("lays a kept key afresh when another workflow took it off the document in between", () => {
    const run = freshRun({ workflow: "target_acquisition", backend: NO_BACKEND, flow: targetAcquisition });
    run.session.password = "hunter2";
    run.wf = "three_steps";
    startOver(run, NO_BACKEND, threeSteps);
    expect(run).not.toHaveProperty("session");
    run.wf = "target_acquisition";
    startOver(run, NO_BACKEND, targetAcquisition);
    expect(run.session).toBeDefined();
    expect(run.session.password).not.toBe("hunter2");
    expect(run.instruments).toEqual([]);
  });

  it("keeps target acquisition's session and instruments, as before", () => {
    const run = freshRun({ workflow: "target_acquisition", backend: NO_BACKEND, flow: targetAcquisition });
    run.session.password = "hunter2"; run.instruments = [{ key: "mock" }]; run.carrier.kind = "slide";
    startOver(run, NO_BACKEND, targetAcquisition);
    expect(run.session.password).toBe("hunter2");
    expect(run.instruments).toEqual([{ key: "mock" }]);
    expect(run.carrier.kind).not.toBe("slide");
  });
});

describe("what a browser test may read", () => {
  afterEach(() => { delete globalThis.window; });

  it("is the framework's fields plus the flow's own", () => {
    globalThis.window = {};
    const run = freshRun({ workflow: "three_steps", backend: NO_BACKEND, flow: threeSteps });
    run.counted = 2; run.done.add("begin");
    exposeTheRunForTests(run, () => threeSteps);
    const seen = window.__theRunState();
    expect(seen.done).toEqual(["begin"]);
    expect(seen.counted).toBe(2);
    expect(seen).not.toHaveProperty("focus");
  });

  it("follows the workflow of the moment", () => {
    globalThis.window = {};
    let flow = threeSteps;
    const run = freshRun({ workflow: "three_steps", backend: NO_BACKEND, flow });
    exposeTheRunForTests(run, () => flow);
    expect(window.__theRunState()).toHaveProperty("counted");
    flow = { forTests: () => ({ other: true }) };
    expect(window.__theRunState()).toHaveProperty("other");
    expect(window.__theRunState()).not.toHaveProperty("counted");
  });
});
