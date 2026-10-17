/* The walk of the steps in turn, as the framework holds it: a step that
   walks the others says so with `walks`, and the operator's Interrupt of the
   walk is the framework's -- latch the walk to end after the step in hand,
   and brake that step where it has a brake. */

import { describe, it, expect } from "vitest";
import { installRunner } from "./runner.ts";
import type { FramePage } from "../types.ts";

function aPage({ walking = true, inHand = "count", braked = [] as unknown[][] } = {}) {
  const steps = [
    { id: "count", brake: (page: unknown) => braked.push(["count", page]) },
    { id: "finish" },
    { id: "protocol", walks: { press: () => {}, whileWalking: "walking" } },
  ];
  const run = {
    running: inHand, interrupting: null,
    walk: { running: walking, interrupted: false },
    activeIdx: steps.findIndex((s) => s.id === inHand),
  };
  let actionBarDrawn = 0;
  const page = {
    run, steps: () => steps, step: (i: number) => steps[i],
    renderActionBar: () => { actionBarDrawn += 1; },
    drawn: () => actionBarDrawn,
  };
  /* Only what the runner reaches for is here. */
  const whole = page as unknown as FramePage & { drawn(): number };
  Object.assign(whole, installRunner(whole));
  return whole;
}

describe("interrupting the walk", () => {
  it("latches the walk to end, and brakes the step in hand", () => {
    const braked: unknown[][] = [];
    const page = aPage({ braked });
    page.interruptWalk();
    expect(page.run.walk.interrupted).toBe(true);
    expect(page.run.interrupting).toBe("count");
    expect(braked).toEqual([["count", page]]);
    expect(page.drawn()).toBe(1);
  });

  it("only latches the walk when the step in hand has no brake", () => {
    const page = aPage({ inHand: "finish" });
    page.interruptWalk();
    expect(page.run.walk.interrupted).toBe(true);
    expect(page.run.interrupting).toBe(null);
  });

  it("does nothing while no walk runs", () => {
    const braked: unknown[][] = [];
    const page = aPage({ walking: false, braked });
    page.interruptWalk();
    expect(page.run.walk.interrupted).toBe(false);
    expect(braked).toEqual([]);
  });
});
