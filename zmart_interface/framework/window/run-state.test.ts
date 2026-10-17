/* The run document, in two halves: the framework's keys, and whatever the
   workflow says a run of it holds. The framework must be able to make, reset
   and expose a run for a workflow that knows nothing about a microscope --
   the fixture under `framework/fixtures/three_steps/` -- and carry none of
   target acquisition's keys while doing so. */

import { describe, it, expect, afterEach, vi } from "vitest";
import { exposeTheRunForTests, freshRun, startOver } from "./run-state.ts";
import * as threeSteps from "../fixtures/three_steps/flow.ts";

const NO_BACKEND = Object.freeze({});

/* The framework's own keys, written out: what every run has whatever its
   workflow. A new key the framework reads belongs in this list. */
const THE_FRAMEWORKS_KEYS = [
  "wf", "activeIdx", "done", "stale", "ran", "running", "interrupting", "failed",
  "walk", "notes", "tabs", "tab", "sideMounted", "sideFolded",
];

/* A few of a microscope workflow's, as the keys a run of the fixture must
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
    expect(run.walk).toEqual({ running: false, interrupted: false });
  });

  it("is plain data: it holds no function and survives a copy as JSON", () => {
    const run = freshRun({ workflow: "three_steps", backend: NO_BACKEND, flow: threeSteps });
    for (const [key, value] of Object.entries(run)) expect(typeof value, key).not.toBe("function");
  });

  it("holds only the framework's keys for a flow with no state of its own", () => {
    const run = freshRun({ workflow: "plain", backend: NO_BACKEND, flow: {} });
    expect(Object.keys(run).sort()).toEqual([...THE_FRAMEWORKS_KEYS].sort());
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
    run.counted = 3; run.stopAsked = true; run.sideFolded = true;
    run.done.add("begin"); run.activeIdx = 2; run.notes.count = "counted to 3";
    startOver(run, NO_BACKEND, flow);
    expect(run.wf).toBe("three_steps");
    expect(run.sideFolded).toBe(true);
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

  it("takes off what neither the framework nor the flow names, functions too", () => {
    const run = freshRun({ workflow: "three_steps", backend: NO_BACKEND, flow: threeSteps });
    run.leftOver = "a carrier"; run.alsoLeftOver = () => "a handle";
    startOver(run, NO_BACKEND, threeSteps);
    expect(run).not.toHaveProperty("leftOver");
    expect(run).not.toHaveProperty("alsoLeftOver");
  });

});

describe("what a browser test may read", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  /* What a test reads off the page's window, which there is none of here. */
  const read = () => (window.__theRunState?.() ?? {}) as Record<string, unknown>;

  it("is the framework's fields plus the flow's own", () => {
    vi.stubGlobal("window", {});
    const run = freshRun({ workflow: "three_steps", backend: NO_BACKEND, flow: threeSteps });
    run.counted = 2; run.done.add("begin");
    exposeTheRunForTests(run, () => threeSteps);
    const seen = read();
    expect(seen.done).toEqual(["begin"]);
    expect(seen.counted).toBe(2);
    expect(seen).not.toHaveProperty("focus");
  });

  it("follows the workflow of the moment", () => {
    vi.stubGlobal("window", {});
    let flow: { forTests(run: object): Record<string, unknown> } = threeSteps;
    const run = freshRun({ workflow: "three_steps", backend: NO_BACKEND, flow: threeSteps });
    exposeTheRunForTests(run, () => flow);
    expect(read()).toHaveProperty("counted");
    flow = { forTests: () => ({ other: true }) };
    expect(read()).toHaveProperty("other");
    expect(read()).not.toHaveProperty("counted");
  });
});
