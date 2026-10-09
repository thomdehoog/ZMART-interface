/**
 * The channel beside the canvas: the column that holds the controls of the
 * step being stood on.
 *
 * The channel belongs to the step standing in it. Every step that has
 * controls declares a `channel` -- what it is called, and how to mount it
 * into the column -- and this file puts the right one there, mounting it
 * once per step rather than on every render, so that a field being typed
 * into is never destroyed under the operator's hands. One column, because
 * two would take the picture's width to show controls for a step nobody is
 * on.
 */

/** Put the channel on the page: `sideWidget()` and `renderSide(show)`. */
export function installSide(page) {
  const { run: state, panels: thePanels, step } = page;

  /* A step's channel: the controls the step declared, or none. */
  const sideWidget = () => step(state.activeIdx)?.channel ?? null;

  function renderSide(show) {
    /* Only a panel with a channel down its side has anywhere to put a step's
       controls. A workflow whose panels have none gives its steps panels of
       their own instead. */
    const host = thePanels[show]?.channel;
    if (!host) return;
    const widget = sideWidget();
    /* The picture's own panel is mounted beside the column but never shown:
       the row over the picture is where the operator reaches it. */
    const display = thePanels[show].display ?? null;
    if (display) display.hidden = true;
    /* Folded, the column is away to the right and only its fold strip stays,
       the press that brings it back. */
    const somethingToShow = Boolean(widget);
    const folded = state.sideFolded && somethingToShow;
    host.hidden = !widget || folded;
    // the divider is the column's edge, so it is only there when the column is
    thePanels[show].divider.hidden = !somethingToShow || folded;
    const fold = thePanels[show].fold;
    if (fold) {
      fold.hidden = !somethingToShow;
      fold.classList.toggle("collapsed", folded);
      const icon = fold.querySelector("span") ?? fold;
      icon.textContent = folded ? "‹" : "›";
      fold.title = folded ? "Open right sidebar" : "Collapse right sidebar";
      fold.setAttribute("aria-label", fold.title);
      fold.setAttribute("aria-expanded", String(!folded));
    }
    /* Only while something runs. Settings used to lock once a later step had
       imaged against them; now they stay editable and the later steps go
       orange, since every result is read against the plan as it was scanned. */
    const locked = !!state.running || state.protocol.running;
    const key = widget && `${widget.id}:${locked}`;
    /* A channel that rebuilds on every render says so; the rest keep their
       state and mount once per key. */
    if (state.sideMounted === key && !widget?.rebuildsOnEveryRender) return;
    state.sideMounted = key;
    state.editor?.destroy?.();
    state.editor = null;
    host.textContent = "";
    if (!widget) return;
    widget.mount(host, page, { locked });
    /* What a workflow puts over every step's controls -- the progress of a
       walk through its steps, say -- it adds here, once the step's own
       controls are in. */
    for (const mounted of page.onChannelMounted) mounted(host, widget);
  }

  /* The channel's width is the operator's to set. The divider drags, the
     variable moves, and everything that reads --side-w — the channel and the
     name over it — follows. Written on the root, so the width survives
     walking between steps; the canvas is the bigger half by default and
     keeps whatever the channel does not take. Clamped so neither the picture
     nor the controls can be crushed. */
  for (const withAnEdge of Object.values(thePanels).filter((p) => p.divider)) {
    const divider = withAnEdge.divider;
    const body = divider.parentElement;
    let resizing = false;
    divider.addEventListener("pointerdown", (e) => {
      resizing = true;
      divider.classList.add("dragging");
      divider.setPointerCapture(e.pointerId);
    });
    divider.addEventListener("pointermove", (e) => {
      if (!resizing) return;
      const box = body.getBoundingClientRect();
      /* No narrower than the widest card's row: the focus step's two hand
         tools and two counts side by side, which a 240 px column cut in
         half. */
      const width = Math.max(440, Math.min(box.width - 360, Math.round(box.right - e.clientX)));
      document.documentElement.style.setProperty("--side-w", `${width}px`);
      /* The channel's own observers redraw what lives in it; the panel
         beside it is told it is on screen again, since its box — the thing
         observed — has not moved, and a panel that draws re-measures on
         that word. */
      withAnEdge.shown?.();
    });
    const settle = (e) => {
      if (!resizing) return;
      resizing = false;
      divider.classList.remove("dragging");
      if (divider.hasPointerCapture?.(e.pointerId)) divider.releasePointerCapture(e.pointerId);
    };
    divider.addEventListener("pointerup", settle);
    divider.addEventListener("pointercancel", settle);
    /* The fold on the same edge: the column goes away to the right and the
       panel takes the room, or comes back the same width it had. The panel
       is told for the same reason as above. */
    withAnEdge.fold?.addEventListener("click", () => {
      state.sideFolded = !state.sideFolded;
      renderSide(page.shownPanel());
      page.renderTabs();
      withAnEdge.shown?.();
    });
  }

  return { sideWidget, renderSide };
}
