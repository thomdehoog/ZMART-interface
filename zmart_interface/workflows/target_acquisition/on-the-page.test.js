/* Target acquisition's hooks: what it does when the page tells it the run
   starts over or another workflow is chosen. The clock that reads where the
   stage is must stop either way -- left running, it would go on asking a
   closed session, or another workflow's backend, where its stage is. */

import { describe, it, expect } from "vitest";
import { theHooksOf } from "./on-the-page.js";

function aPage() {
  const stopped = [];
  const page = {
    stageWatch: { stop: () => stopped.push("stopped") },
    view: { fitted: true },
    shown: {},
    renderPointList: () => {},
    listInstruments: () => {},
  };
  return { page, stopped };
}

describe("the stage's clock", () => {
  it("stops when the run starts over, as on Disconnect", () => {
    const { page, stopped } = aPage();
    theHooksOf(page).onReset();
    expect(stopped).toEqual(["stopped"]);
    expect(page.stageWatch).toBe(null);
    expect(page.view.fitted).toBe(false);
  });

  it("stops when another workflow is chosen", () => {
    const { page, stopped } = aPage();
    theHooksOf(page).onLeave();
    expect(stopped).toEqual(["stopped"]);
    expect(page.stageWatch).toBe(null);
  });
});
