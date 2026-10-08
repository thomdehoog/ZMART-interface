/**
 * The Scan the overview step's channel: what the scan will do, the test
 * tiles it is rehearsed on, its progress, and the press that starts it.
 *
 * The scan consults nothing: it takes the run's one recorded preset, and it
 * keeps focus with the map the focus step generated — or at every position,
 * when no map was measured. There is nothing here to choose, so the channel
 * is a short summary the operator can check at a glance, and the press that
 * starts the scan.
 */

import { sideGroup } from "../../../../framework/window/panels.js";
import { progressBox } from "../../shared/progress.js";
import { sharePoints } from "../../shared/scanfields.js";

/* So many tiles in each tileset, spread over it the way Step 4 spreads its
   focus points: the ground is shared out by `sharePoints`, and each share
   takes the nearest tile not yet taken. Not a random draw -- the same
   press gives the same tiles (Thom, 2026-09-28). */
function testTilesPerTileset(state, n) {
  const groups = new Map();
  state.plan.forEach((t, i) => {
    const key = t.tileset ?? t.fieldId ?? "plan";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  });
  const chosen = [];
  for (const held of groups.values()) {
    const taken = new Set();
    for (const p of sharePoints(held.map((i) => state.plan[i]), n)) {
      let best = null;
      for (const i of held) {
        if (taken.has(i)) continue;
        const d = Math.hypot(state.plan[i].x - p.x, state.plan[i].y - p.y);
        if (!best || d < best.d) best = { i, d };
      }
      if (best) { taken.add(best.i); chosen.push(best.i); }
    }
  }
  return chosen;
}

/* The test tiles changed, on the picture or in the box: Step 5's own
   setting edited, so the steps after it are orange and the box says the
   new count. */
export function testTilesChanged(page) {
  page.stateEdited("scan");
  page.run.sideMounted = null;
  page.drawStage();
  page.renderAll();
}

export const scanChannel = {
  id: "scan",
  label: "Scan the overview",
  mount(host, page) {
    const state = page.run;
    const pad = document.createElement("div");
    pad.className = "side-pad-around";
    host.append(pad);

    /* What the scan will do, as labelled rows: how many positions, how
       wide each frame, and how the focus is found at each. */
    const { group, body } = sideGroup("Scan summary");
    const summary = document.createElement("div");
    summary.className = "scan-summary";
    const row = (label, value) => {
      const key = document.createElement("div");
      key.className = "k";
      key.textContent = label;
      const val = document.createElement("div");
      val.className = "v";
      val.textContent = value;
      summary.append(key, val);
    };
    /* The protocol takes the whole plan whatever is green. */
    const testing = state.testTiles.size && !state.protocol.running;
    row("Positions", testing
      ? `${state.testTiles.size} of ${state.plan.length} (test tiles)` : String(state.plan.length));
    const frameUm = state.plan[0]?.frameUm;
    if (frameUm) row("Frame", `${Math.round(frameUm)} µm`);
    const measured = state.focus.applied && state.focus.strategy === "plane";
    row("Focus", measured
      ? (state.focus.surface ? `measured map · ${page.focusFitWord(state.focus)}` : "no focus map")
      : "found at every position");
    body.append(summary);

    /* The test tiles: a few of the plan pressed green, on the picture or
       drawn at random, so the protocol is rehearsed on them before the
       whole area is scanned. The scan takes only the green tiles while
       any are green; the protocol run takes the whole plan regardless. */
    const test = sideGroup("Test tiles");
    test.group.id = "test-tiles";
    const draw = document.createElement("div");
    draw.className = "test-tiles-row";
    draw.id = "test-tiles-count";
    draw.dataset.green = String(state.testTiles.size);
    const lay = document.createElement("div");
    lay.className = "fp-lay";
    const n = document.createElement("input");
    n.type = "number"; n.min = "1"; n.max = String(Math.max(1, state.plan.length)); n.step = "1";
    n.id = "test-n";
    n.title = "How many tiles to select in each tileset, spread over it as the focus points are";
    n.value = String(Math.min(state.plan.length, state.testN ?? 3));
    n.addEventListener("input", () => { state.testN = Number(n.value); });
    const random = document.createElement("button");
    random.type = "button"; random.className = "sf-flat sf-doing"; random.id = "test-random";
    random.textContent = "Select tiles";
    random.disabled = !!state.running || state.protocol.running || !state.plan.length;
    random.addEventListener("click", () => {
      const asked = Math.max(1, Number(n.value) || 1);
      state.testTiles = new Set(testTilesPerTileset(state, asked));
      testTilesChanged(page);
    });
    const clear = document.createElement("button");
    clear.type = "button"; clear.className = "sf-flat"; clear.id = "test-clear";
    clear.textContent = "Clear all";
    clear.disabled = !!state.running || state.protocol.running || !state.testTiles.size;
    clear.addEventListener("click", () => { state.testTiles = new Set(); testTilesChanged(page); });
    lay.append(n, random);
    draw.append(lay, clear);
    test.body.append(draw);

    /* The scan's progress, the same box the acquisition has: built with the
       panel, spoken to by the run. */
    const scanProgress = progressBox("Scan progress");
    scanProgress.doing.id = "scan-doing";
    scanProgress.count.id = "scan-count";
    page.shown.scanProgress = scanProgress;
    pad.append(group, test.group, scanProgress.group);

    // and the press that starts it, at the end of what it acts on
    const action = document.createElement("div");
    action.className = "scan-action side-act";
    pad.append(action);
    page.renderActionBar();
  },
};

/** Arriving at the scan: the focus stack was there to judge the focus; over
    the overview it is a square of other pixels on the picture the operator
    came to look at. Its eye is pressed for them on the way to the scan. */
export function scanArrived() {
  window.__viewerPanel?.showAcquisition?.("focussing", false);
}
