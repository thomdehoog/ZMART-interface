// @vitest-environment jsdom
/* One page per workflow, over one frame.

   The frame -- the rail, the chooser, the runner, the tabs, the channel and
   the action bar -- is one. Each workflow gets its own page built over it,
   with what it lends and its own panels, and only the open workflow's hooks
   run; the workflow being left hears `onLeave`. The run document stays one
   object. These are tried with the framework's own fixture and a second
   workflow made up here, so they need no microscope. */

import { beforeEach, describe, expect, it } from "vitest";
import { assembleWorkflows } from "../rules/finding-workflows.ts";
import * as threeSteps from "../fixtures/three_steps/flow.ts";
import { composeThePages } from "./pages.ts";
import type { Flow } from "../types.ts";

let heard: string[];

/* The fixture, its hooks heard as they run and something lent. */
const listened = {
  ...threeSteps,
  install(page: Parameters<typeof threeSteps.install>[0]) {
    const answer = threeSteps.install(page);
    return {
      lends: { ...answer?.lends, threeLent: () => "three" },
      hooks: {
        ...answer?.hooks,
        onRender: () => { answer?.hooks?.onRender?.(); heard.push("three:render"); },
        onReset: () => { heard.push("three:reset"); },
        onLeave: () => { heard.push("three:leave"); },
      },
    };
  },
};

/* A second workflow with a panel and a step of its own. */
const other = {
  blurb: "Another workflow, for the test.",
  panels: [{
    key: "board", label: "Board", stays: true,
    build(host: HTMLElement) {
      const foot = document.createElement("div");
      host.append(foot);
      return { foot };
    },
  }],
  steps: [{ id: "look", title: "Look", panels: ["board"] }],
  install: () => ({
    lends: { otherLent: () => "other" },
    hooks: {
      onRender: () => { heard.push("other:render"); },
      onReset: () => { heard.push("other:reset"); },
      onLeave: () => { heard.push("other:leave"); },
    },
  }),
} satisfies Flow;

function theFrame() {
  document.body.innerHTML = `
    <select id="wf-select"></select>
    <div id="steps"></div>
    <div id="tabs"></div>
    <div class="stage"></div>
    <div id="status-bar" hidden></div>`;
}

function compose() {
  const { WORKFLOWS } = assembleWorkflows({ "three_steps/flow.js": listened, "other/flow.js": other });
  return composeThePages({ WORKFLOWS, opensOn: "three_steps", search: new URLSearchParams() });
}

beforeEach(() => {
  heard = [];
  theFrame();
});

describe("one page per workflow", () => {
  it("runs only the open workflow's hooks", () => {
    const pages = compose();
    pages.open();
    expect(heard).toContain("three:render");
    expect(heard.filter((one) => one.startsWith("other:"))).toEqual([]);
  });

  it("tells the workflow being left, then resets and renders the one chosen", () => {
    const pages = compose();
    pages.open();
    heard = [];
    pages.switchWorkflow("other");
    expect(heard[0]).toBe("three:leave");
    expect(heard).toContain("other:reset");
    expect(heard).toContain("other:render");
    expect(heard.filter((one) => one.startsWith("three:"))).toEqual(["three:leave"]);
  });

  it("keeps each workflow's lends on its own page", () => {
    const pages = compose();
    pages.open();
    pages.switchWorkflow("other");
    /* What a page was lent is the workflow's, beside the framework's own parts. */
    const lent = (key: string) => pages.pageFor(key) as unknown as Record<string, (() => string) | undefined>;
    expect(lent("three_steps").threeLent?.()).toBe("three");
    expect(lent("three_steps").otherLent).toBeUndefined();
    expect(lent("other").otherLent?.()).toBe("other");
    expect(lent("other").threeLent).toBeUndefined();
  });

  it("gives each workflow its own panels, and shows only the open one's", () => {
    const pages = compose();
    pages.open();
    const three = pages.pageFor("three_steps");
    expect(Object.keys(three.panels)).toEqual(["card"]);
    expect(three.panels.card.host.classList.contains("on")).toBe(true);
    pages.switchWorkflow("other");
    const board = pages.pageFor("other").panels.board;
    expect(Object.keys(pages.pageFor("other").panels)).toEqual(["board"]);
    expect(board.host.classList.contains("on")).toBe(true);
    expect(three.panels.card.host.classList.contains("on")).toBe(false);
  });

  it("keeps one run document, swapped with the workflow", () => {
    const pages = compose();
    pages.open();
    const run = pages.pageFor("three_steps").run;
    run.counted = 2;
    pages.switchWorkflow("other");
    expect(pages.pageFor("other").run).toBe(run);
    expect(run.wf).toBe("other");
    expect(run).not.toHaveProperty("counted");
  });

  it("offers every workflow in the chooser, and switches when one is chosen", () => {
    const pages = compose();
    pages.open();
    const chooser = document.querySelector<HTMLSelectElement>("#wf-select");
    if (!chooser) throw new Error("the frame has no chooser");
    expect([...chooser.options].map((o) => o.value)).toEqual(["other", "three_steps"]);
    chooser.value = "other";
    chooser.dispatchEvent(new Event("change"));
    expect(pages.pageFor("other").run.wf).toBe("other");
    expect(heard).toContain("three:leave");
  });
});
