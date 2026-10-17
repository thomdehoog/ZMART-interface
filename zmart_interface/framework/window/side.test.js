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

describe("where the standing step's press goes", () => {
  function aPage(answer) {
    const run = { sideMounted: null, activeIdx: 0, running: null, walk: { running: false }, sideFolded: false };
    const host = { hidden: false, textContent: "" };
    const channel = { id: "count", label: "Count", mount: () => answer };
    const page = { run, panels: { card: { channel: host } }, step: () => ({ id: "count", channel }), hooks: {} };
    Object.assign(page, installSide(page));
    return page;
  }

  it("is the slot the step's controls answered when they were mounted", () => {
    const slot = { textContent: "" };
    const page = aPage({ actionSlot: slot });
    page.renderSide("card");
    expect(page.actionSlot()).toBe(slot);
    expect(page.activeStep().id).toBe("count");
  });

  it("is nothing for controls that have no place for it", () => {
    const page = aPage(undefined);
    page.renderSide("card");
    expect(page.actionSlot()).toBe(null);
  });
});
