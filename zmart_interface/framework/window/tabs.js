/**
 * The panels on the right, the tabs that name them, and the render that
 * brings the whole page up to date.
 *
 * Which panels a step gets is `panelsFor` in `../rules/steps.js`, and the
 * reason it lives there rather than here is that it is a rule about steps
 * rather than about this page. What it comes to for the workflows on offer:
 *
 * The canvas is the microscope's own limits drawn to scale, so it is there
 * from the first step that asks for it. Nothing about the frame depends on
 * the carrier chosen inside it; the carrier only says where within those
 * limits the sample sits. From there the canvas is the window into the run,
 * filling with data rather than appearing once data exists. The tab set is
 * rebuilt on every render rather than growing forever. It belongs to the
 * steps that happen inside it, and to no others — the same rule every other
 * panel follows. Which makes this a question about the step being looked
 * at, not about how far the run has got.
 */

import { el } from "./dom.js";

/**
 * Put the panels on the page: `focusPanelsFor(i)`, `shownPanel()`,
 * `renderTabs()`, `renderPanels()` and `renderAll()`.
 *
 * Two lists on the page let other modules take part: `page.onPanelShown`
 * is called with the step and the panel's key whenever a panel is drawn,
 * and `page.onRender` after every full render.
 */
export function installTabs(page) {
  const { run: state, panels: thePanels, step, tabsForStep } = page;

  /** The operator arrived at step `i`: work out its tabs, and let the step
      arrange the picture the way it wants to be looked at. */
  function focusPanelsFor(i) {
    state.tabs = tabsForStep(i);
    // a step that brings a panel of its own opens on it; otherwise the base
    state.tab = state.tabs.length > 1 ? state.tabs[1] : state.tabs[0];
    /* What a step does to the picture on arrival -- which layers to show,
       which acquisition to hide -- is the step's own business. */
    step(i)?.arrived?.(page);
  }

  /* Always drawn, even for one. It names what is loaded — the Canvas — and
     naming what you are looking at is worth a line whether or not there is a
     second one to switch to. */
  function renderTabs() {
    const host = el("tabs");
    host.textContent = "";

    for (const key of state.tabs) {
      const meta = thePanels[key];
      const b = document.createElement("button");
      b.className = "tab"; b.type = "button"; b.role = "tab";
      b.setAttribute("aria-selected", String(state.tab === key));
      b.append(document.createTextNode(meta.label));

      b.addEventListener("click", () => { state.tab = key; renderPanels(); renderTabs(); });
      host.append(b);
    }

    /* The channel beside the canvas is named where it sits, at the right end
       of the same row and over the column it heads. Not a tab: it is not an
       alternative to the canvas, it is the controls for what the canvas is
       showing — so it says whose controls those are rather than offering a
       switch. */
    const owner = thePanels[shownPanel()]?.channel ? page.sideWidget() : null;
    /* A folded column has no heading: the strip on its edge is all that is
       left of it, and the name would stand over the canvas. */
    if (owner && !state.sideFolded) {
      const side = document.createElement("span");
      side.className = "side-tab";
      /* The name is its own element: it carries the rule under it, so that
         rule is as wide as the word the way a tab's is, rather than as wide
         as the channel this stands over. */
      const label = document.createElement("span");
      label.textContent = owner.label;
      side.append(label);
      host.append(side);
    }
  }

  const shownPanel = () => (state.tabs.includes(state.tab) ? state.tab : state.tabs[0]);

  function renderPanels() {
    const show = shownPanel();
    if (!show) return;
    /* By element, not by key: the setup steps share one, so asking each key in
       turn would switch it on for its own and straight back off for the next. */
    for (const [key, panel] of Object.entries(thePanels)) {
      panel.host.classList.toggle("on", key === show);
    }
    page.renderSide(show);
    page.renderStepAction(show);
    /* A panel that draws something of its own is told it is on screen: a
       picture cannot be laid out while it is hidden, because a hidden box has
       no size. A panel with nothing to re-measure simply says nothing. */
    thePanels[show].shown?.();
    for (const told of page.onPanelShown) told(step(state.activeIdx), show);
  }

  function renderAll() {
    /* The step being looked at decides the tab set on its own, so this is the
       one place that has to agree with it — recomputed rather than trusted,
       and the selection kept only while it still names a tab that is there. */
    state.tabs = tabsForStep(state.activeIdx);
    if (!state.tabs.includes(state.tab)) state.tab = state.tabs[0];

    page.renderRail();
    page.renderActionBar();
    renderTabs();
    renderPanels();
    for (const also of page.onRender) also();
  }

  return { focusPanelsFor, renderTabs, shownPanel, renderPanels, renderAll };
}
