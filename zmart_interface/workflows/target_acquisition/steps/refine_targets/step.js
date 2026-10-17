/**
 * Step 7 — Discover Targets.
 *
 * Refinement is the same shape as discovery: the refined targets light up on
 * the canvas, and the channel holds the scatter they are gated on
 * (`channel.js` and `gate.js`).
 */

import { gatesArrived, gatesSettledByStanding, gatingChannel } from "./channel.js";

export const selectCells = {
  id: "gate",
  title: "Discover Targets",
  panels: [],
  mode: "gate",
  /* The gates have no press: looking at them applies them. */
  settledByStanding: gatesSettledByStanding,
  arrived: gatesArrived,
  channel: gatingChannel,
};
