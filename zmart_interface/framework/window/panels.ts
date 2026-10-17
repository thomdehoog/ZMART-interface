/**
 * The boxes that stand down the channel beside the canvas.
 *
 * Every step's controls live in one or more of these: a heading naming what the
 * box is for, and a card holding the controls themselves. One shape, on every
 * step, because two shapes would read as two kinds of thing and these are not.
 *
 * The heading sits *above* its card rather than inside it, so the card holds
 * controls and nothing else. That is a decision the stylesheet makes as much as
 * this file does — see `.side-group`, `.side-group-title` and `.side-group-body`
 * in `framework/window/style.css`, which is where the spacing and the reasoning behind it
 * are written down.
 *
 * ## A note on where this came from
 *
 * This file was missing from the branch that introduced it: three modules
 * imported `sideGroup` from here and the file itself was never committed, so
 * the page would not load at all. It has been written back from what the rest
 * of the code requires of it — the three call sites fix the interface, and the
 * stylesheet names every class and says how they nest. So it is a
 * reconstruction rather than a recovery, and if the original had anything more
 * in it, that is where the difference will be.
 */

import type { BuiltPanel, Panel } from "../types.ts";

/**
 * Make one box for the channel: a heading, and a card to put controls in.
 *
 * @param title what the box is for, shown above the card.
 * @param extra an optional further class on the box, for the few places that
 *   need to style one differently — the carrier's layout box asks for
 *   `carrier-sizes`, which gives it a little more room inside.
 * @returns `{ group, body }` — `group` is the whole box, to be added to the
 *   channel, and `body` is the card inside it, which is where controls go.
 *   Both are handed back because callers need them for different things: the
 *   box is what gets placed, the card is what gets filled.
 */
export function sideGroup(title: string, extra?: string): { group: HTMLDivElement; body: HTMLDivElement } {
  const group = document.createElement("div");
  group.className = extra ? `side-group ${extra}` : "side-group";

  const heading = document.createElement("div");
  heading.className = "side-group-title";
  heading.textContent = title;

  const body = document.createElement("div");
  body.className = "side-group-body";

  group.append(heading, body);
  return { group, body };
}

/**
 * Build the panels a workflow declares, one element apiece inside the stage,
 * and hand them back by key.
 *
 * The framework builds the box and knows what a panel is called, whether it
 * stays once asked for, and whether it has a channel down its side; what
 * goes in it, and what any of it means, is the workflow's, which fills it
 * through the panel's own `build(host)`.
 *
 * A workflow's panels are its own: built once, when its page is, and kept,
 * so switching workflows shows a different set of them rather than
 * rebuilding, and two workflows never share one.
 */
export function buildThePanels(flow: { panels: Panel[] }): Record<string, BuiltPanel> {
  const stage = document.querySelector(".stage");
  if (!stage) throw new Error("the page has no stage to put its panels on");
  const thePanels: Record<string, BuiltPanel> = {};
  for (const declared of flow.panels) {
    const host = document.createElement("div");
    host.className = "panel";
    host.setAttribute("role", "tabpanel");
    stage.append(host);
    thePanels[declared.key] = { ...declared, host, ...(declared.build?.(host) ?? {}) };
  }
  return thePanels;
}
