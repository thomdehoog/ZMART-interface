// @vitest-environment jsdom
/* The workflow API keeps its word.

   `fixtures/three_steps_at_1_0_0/` is the framework's fixture as it stood when
   the API became 1.0.0, and it is never edited. It uses every field and hook
   the API offered then. That it still type-checks is `tsc`'s to say; that it
   still walks -- the page built over it, its steps run in turn, its walk
   walking them again -- is said here. Should either stop holding, a workflow
   written for 1.0.0 would no longer fit, and the API has changed in a way that
   needs a new major version. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assembleWorkflows } from "../rules/finding-workflows.ts";
import * as frozen from "../fixtures/three_steps_at_1_0_0/flow.ts";
import { composeThePages } from "./pages.ts";

const FOLDER = "three_steps_at_1_0_0";

function theFrame() {
  document.body.innerHTML = `
    <select id="wf-select"></select>
    <div id="steps"></div>
    <div id="tabs"></div>
    <div class="stage"></div>
    <div id="status-bar" hidden></div>`;
}

/** The page built over the frozen fixture, opened. */
function opened() {
  const { WORKFLOWS } = assembleWorkflows({ [`${FOLDER}/flow.ts`]: frozen });
  const pages = composeThePages({ WORKFLOWS, opensOn: FOLDER, search: new URLSearchParams() });
  pages.open();
  return pages.pageFor(FOLDER);
}

/** Run a step to its end, the clock moved on until it has one. */
async function ran(page: ReturnType<typeof opened>, id: string) {
  const running = page.runStep(page.indexOfStep(id));
  await vi.runAllTimersAsync();
  return (await running).outcome;
}

beforeEach(() => {
  theFrame();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("the fixture frozen at 1.0.0", () => {
  it("is assembled with its five steps, numbered as it numbers them", () => {
    const page = opened();
    expect(page.steps().map((one) => one.id)).toEqual(["begin", "count", "finish", "look", "walk"]);
    expect(page.steps().map((one) => one.n)).toEqual(["1", "2", "3", "4", "5"]);
    expect(page.run.wf).toBe(FOLDER);
  });

  it("walks: each step in turn, then its own walk walks them again", async () => {
    const page = opened();
    expect(await ran(page, "begin")).toBe("finished");
    expect(await ran(page, "count")).toBe("finished");
    expect(page.run.counted).toBe(3);
    expect(page.run.notes.count).toBe("counted to 3");
    expect(await ran(page, "finish")).toBe("finished");
    expect(page.run.notes.finish).toBe("finished");
    expect([...page.run.done]).toEqual(expect.arrayContaining(["begin", "count", "finish"]));

    expect(await ran(page, "walk")).toBe("finished");
    expect(page.run.walk).toEqual({ running: false, interrupted: false });
    expect(page.run.counted).toBe(3);
  });

  it("follows the run on its card, through the hooks it was written with", async () => {
    const page = opened();
    const line = () => document.querySelector("#three-steps-line")?.textContent;
    expect(line()).toBe("Nothing counted yet.");
    await ran(page, "begin");
    await ran(page, "count");
    page.renderAll();
    expect(line()).toBe("Counted to 3.");
  });
});
