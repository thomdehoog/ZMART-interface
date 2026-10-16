/**
 * Target acquisition's promises, asked of the pretend backend on every change
 * and of a running bridge when one is given (`BACKEND_BRIDGE`), as
 * `parts/microscope/backend-contract.test.js` does for the shared verbs.
 *
 * Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
 * University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
 */

import { beforeAll, describe, expect, it } from "vitest";
import { isTheMock } from "../../../parts/microscope/instruments.js";
import { backend as sharedPretend } from "../../../parts/microscope/mock.js";
import { promisesOfTargetAcquisition } from "./backend-contract.js";
import { targetAcquisitionPretend } from "./pretend.js";

const promises = promisesOfTargetAcquisition(expect);

describe("Target acquisition's pretend verbs keep their promises", () => {
  const pretend = { ...sharedPretend, ...targetAcquisitionPretend };
  for (const promise of promises) {
    it(promise.what, async () => { await promise.keep(pretend); });
  }
});

/* Only when a bridge is running, and with the same care about which
   microscope is driven as the shared promises take. */
const bridgeAt = process.env.BACKEND_BRIDGE;

describe.skipIf(!bridgeAt)("Target acquisition's live verbs keep the same promises", () => {
  let live = null;

  beforeAll(async () => {
    globalThis.location = { search: `?bridge=${bridgeAt}`, protocol: "http:" };
    const { backend: shared } = await import("../../../parts/microscope/live.js");
    const { targetAcquisition } = await import("./live.js");
    live = { ...shared, ...targetAcquisition };
    const offered = await live.instruments();
    const mockDriver = offered.find(isTheMock);
    if (!mockDriver && process.env.BACKEND_BRIDGE_MAY_MOVE_THE_MICROSCOPE !== "yes") {
      throw new Error(
        "this bridge offers no mock driver, and these promises drive the stage."
        + " Set BACKEND_BRIDGE_MAY_MOVE_THE_MICROSCOPE=yes to run them against"
        + ` the instrument itself (${offered.join(", ")}).`,
      );
    }
    await live.connect({ instrument: mockDriver ?? offered[0] }, { experiment: "target-acquisition" });
  }, 30_000);

  for (const promise of promises) {
    it(promise.what, async () => { await promise.keep(live); }, 30_000);
  }
});
