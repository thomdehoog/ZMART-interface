/**
 * The live backend's focus map, point after point: each search can begin at
 * the height the page found at the point before. The bridge is a fake
 * `fetch` that records where each point was driven.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { backend } from "../../parts/microscope/live.js";

/** A bridge that finds the tissue 10 µm below wherever each stack began. */
function bridgeMeasuringFocus() {
  const drives = [];
  globalThis.fetch = vi.fn(async (url, init) => {
    const route = url.replace(/^http:\/\/[^/]+/, "");
    const body = init?.body ? JSON.parse(init.body) : null;
    const answer = (json) => ({ ok: true, json: async () => json });
    if (route === "/api/focus/begin") {
      return answer({ labels: Array.from({ length: body.of }, (_, i) => `P${i}`) });
    }
    if (route === "/api/xyz") {
      drives.push(body);
      return answer({ x: { position: body.x }, y: { position: body.y }, z: { position: body.z ?? 0 } });
    }
    if (route === "/api/acquire") return answer({ success: true, content: { position_label: body.position_label } });
    if (route === "/api/focus/score") {
      return answer({ ...body.point, z: body.centre - 10, zAuto: body.centre - 10, lost: false });
    }
    if (route === "/api/focus/end") return answer({});
    throw new Error(`unexpected ${route}`);
  });
  return drives;
}

describe("the live focus map", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it("begins each search where beginAt says, over the point's own startZ", async () => {
    const drives = bridgeMeasuringFocus();
    const found = [];
    await backend.measureFocus(
      [{ x: 1, y: 1, startZ: -50 }, { x: 2, y: 2, startZ: -50 }, { x: 3, y: 3, startZ: -50 }],
      {
        metric: "brenner",
        onPoint: (point) => found.push(point.z),
        beginAt: (index) => (index ? found[index - 1] : undefined),
      },
    );
    /* The first point has nothing before it and keeps its own start; each
       later one starts at the height the one before it found. */
    expect(drives.map((d) => d.z)).toEqual([-50, -60, -70]);
  });

  it("keeps the microscope's own sentence on a point it would not drive to", async () => {
    /* The review of 10 October, finding 6: the reason went to the console,
       which the window does not show, and the point then read as a search
       that found no peak. */
    bridgeMeasuringFocus();
    const inner = globalThis.fetch;
    globalThis.fetch = async (url, init) => (url.endsWith("/api/xyz")
      ? { ok: false, json: async () => ({ error: "the stage cannot go beyond its travel" }) }
      : inner(url, init));
    const { points } = await backend.measureFocus([{ x: 1, y: 1 }], { metric: "brenner" });
    expect(points[0]).toMatchObject({ lost: true, z: null, refused: "the stage cannot go beyond its travel" });
  });

  it("reaches a scoring that hangs: the bridge is asked to stop, and the cut point is not kept", async () => {
    /* The review of 10 October, finding 16. The bridge's stop puts the
       analysis down, which makes the hung score answer with an error; that
       point was cut off by the operator's own hand, so it is not a "lost"
       point with the microscope's reason, it is simply not measured. */
    bridgeMeasuringFocus();
    const inner = globalThis.fetch;
    let release;
    const asked = [];
    globalThis.fetch = async (url, init) => {
      const route = url.replace(/^http:\/\/[^/]+/, "");
      asked.push(route);
      if (route === "/api/focus/score") {
        await new Promise((resolve) => { release = resolve; });
        return { ok: false, json: async () => ({ error: "Engine has been shut down" }) };
      }
      if (route === "/api/focus/stop") {
        release();
        return { ok: true, json: async () => ({ running: true }) };
      }
      return inner(url, init);
    };
    const run = backend.measureFocus([{ x: 1, y: 1 }, { x: 2, y: 2 }], { metric: "brenner" });
    while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
    await backend.stopFocusMeasure();
    const { points, stopped } = await run;
    expect(asked).toContain("/api/focus/stop");
    expect(stopped).toBe(true);
    expect(points).toEqual([]);
    expect(asked.filter((route) => route === "/api/xyz")).toHaveLength(1);
  });

  it("keeps the point's own startZ when beginAt has no answer", async () => {
    const drives = bridgeMeasuringFocus();
    await backend.measureFocus([{ x: 1, y: 1, startZ: -50 }, { x: 2, y: 2 }], {
      metric: "brenner", beginAt: () => undefined,
    });
    expect(drives[0].z).toBe(-50);
    expect("z" in drives[1]).toBe(false);
  });
});
