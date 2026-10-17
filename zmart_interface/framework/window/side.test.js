/* The channel's own bookkeeping is the framework's: a workflow asks for a
   step's controls to be mounted afresh, and does not write the key the
   channel keeps. */

import { describe, it, expect } from "vitest";
import { installSide } from "./side.js";

describe("mounting the step's controls afresh", () => {
  it("is asked of the channel, which forgets what it mounted", () => {
    const run = { sideMounted: "focus:false", activeIdx: 0, running: null, walk: { running: false } };
    const page = { run, panels: {}, step: () => null };
    Object.assign(page, installSide(page));
    page.remountChannel();
    expect(run.sideMounted).toBe(null);
  });
});
