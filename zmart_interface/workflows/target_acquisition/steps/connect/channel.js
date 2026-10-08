/**
 * The Connect step's channel: the session card, and opening a run on a
 * protocol.
 *
 * The card reads downward — the form, the checks, what they came to, and the
 * button that acts on all of it. Its button is its own rather than the
 * framework's, because it waits for an instrument to be chosen and it
 * changes what it does once a session is open. The card rebuilds on every
 * render, so nothing in it goes stale.
 */

import { applyProtocol, protocolFits } from "../../../../framework/window/protocol.js";
import { freshSettings } from "../../../../framework/window/run-state.js";
import { choicesFrom, theMockAmong } from "../../../../parts/microscope/instruments.js";
import { activeRecording } from "../../../../parts/microscope/recordings.js";
import { renderSessionCard } from "./session-card.js";

/* The instrument the card has chosen: a microscope from the list and one
   of its drivers. The name under them is what Connect sends. */
export const chosenMicroscope = (page) =>
  page.run.instruments.find((m) => m.key === page.run.session.microscope);
const chosenApi = (page) => chosenMicroscope(page)?.apis.find((a) => a.key === page.run.session.api);
export const chosenInstrument = (page) => chosenApi(page)?.instrument ?? null;

/* Ask the backend what can be connected to, and choose for the operator
   when nothing is chosen yet: the mock when it is listed, so a page opened
   by accident drives nothing, otherwise the first entry. */
export function listInstruments(page) {
  const state = page.run;
  return page.backend.instruments().then((list) => {
    state.instruments = choicesFrom(list);
    if (!chosenMicroscope(page)) {
      const mock = theMockAmong(state.instruments);
      state.session.microscope = mock?.microscope ?? state.instruments[0]?.key ?? null;
      if (mock) state.session.api = mock.api;
    }
    if (!chosenApi(page)) state.session.api = chosenMicroscope(page)?.apis[0]?.key ?? null;
    renderSetup(page); page.renderActionBar();
    return listProtocols(page);
  }).catch((why) => {
    state.instruments = [];
    state.session.microscope = null; state.session.api = null;
    console.warn(`could not list the instruments: ${why.message}`);
    renderSetup(page); page.renderActionBar();
  });
}

/* The session card, and the handle it gives back: a check's answer lands in
   the row the card already put on screen. */
function mountTheCard(host, page) {
  const state = page.run;
  page.shown.session = renderSessionCard(host, {
    connected: () => state.done.has("connect"),
    connecting: () => state.running === "connect",
    running: () => state.running,
    session: () => state.session,
    instruments: () => state.instruments,
    checks: () => state.checks,
    chosenMicroscope: () => chosenMicroscope(page),
    chosenInstrument: () => chosenInstrument(page),
    connect: () => page.runStep(page.indexOfStep("connect")),
    /* Closing takes the run with it, for the reason resetRun gives:
       everything after this was read off this session. It works while
       something is running -- that is when an operator needs it. A step
       still in flight finds `running` cleared under it and stops there;
       the session it was talking to is closed at the bridge. */
    disconnect: () => {
      page.backend?.disconnect?.().catch((why) => console.warn(`closing: ${why.message}`));
      page.resetRun();
      page.thePicture.reset();
      page.stage.forgetTheCanvas();
      page.renderAll();
      listProtocols(page);
    },
    changed: () => { renderSetup(page); page.renderActionBar(); listProtocols(page); },
    /* The protocols this machine has written, and the one this run is
       opened on. Only a backend that keeps protocols offers the box. */
    protocols: page.backend.protocols ? () => state.protocols : null,
    protocolChosen: () => state.protocolChosen,
    protocolNote: () => state.protocolNote,
    chooseProtocol: (id) => chooseProtocol(page, id),
    chooseProtocolFromFile: (file) => chooseProtocolFromFile(page, file),
  });
}

/* A run opened on a protocol: once the focus map has been measured on
   this sample, the steps after it come back from the file -- done, and
   orange, each to be confirmed or run here (Thom, 2026-09-28). */
export function theRestOfTheProtocolAppears(page) {
  const state = page.run;
  if (!state.protocolPending) return;
  state.protocolPending = false;
  const from = page.indexOfStep("focus");
  page.steps().forEach((s, i) => {
    if (i <= from) return;
    state.done.add(s.id);
    state.stale.add(s.id);
  });
  page.renderRail();
}

/** The protocols under the machine's output root: asked for the chosen
    connection before connecting, and again once the session knows the
    root for certain. */
export async function listProtocols(page) {
  const state = page.run;
  if (!page.backend.protocols) return;
  try {
    state.protocols = await page.backend.protocols(state.done.has("connect") ? null : chosenInstrument(page));
  } catch (why) {
    console.warn(`listing protocols: ${why.message}`);
    state.protocols = [];
  }
  renderSetup(page);
}

/** A protocol read from a file the operator picked: opened on like a listed one. */
function chooseProtocolFromFile(page, file) {
  const state = page.run;
  file.text().then((text) => {
    let protocol;
    try {
      protocol = JSON.parse(text);
    } catch {
      state.protocolNote = `cannot read ${file.name}: not a protocol file`;
      renderSetup(page);
      return;
    }
    state.protocols = [{ id: file.name.replace(/\.json$/i, ""), written: Date.now() / 1000, protocol, fromFile: true },
      ...state.protocols.filter((one) => !one.fromFile)];
    chooseProtocol(page, state.protocols[0].id);
  });
}

/**
 * Open this run on a written protocol, or on none.
 *
 * The settings of every step are filled from the file and the steps they
 * belong to are done -- and orange, all of them: the carrier's corners are
 * last mount's, the area sits on the carrier, and the rest was settled on
 * another sample. Each is confirmed or run here before the protocol may
 * run. Choosing "new" again puts the settings back to the fresh session's.
 */
function chooseProtocol(page, id) {
  const state = page.run;
  const fresh = () => {
    freshSettings(state, page.backend);
    page.rebuildPlan();
  };
  state.protocolNote = "";
  if (id === null) {
    if (state.protocolChosen !== null) fresh();
    state.protocolChosen = null;
  } else {
    const found = state.protocols.find((one) => one.id === id);
    const refused = found ? protocolFits(state, found.protocol) : "not in the list";
    if (refused) {
      state.protocolNote = `cannot open this protocol: ${refused}`;
      state.protocolChosen = null;
    } else {
      fresh();
      applyProtocol(state, found.protocol);
      state.focusFor = activeRecording(state.focusPreset)?.id ?? null;
      page.rebuildPlan();
      /* Steps 2, 3 and 4 remember their settings and are walked one by
         one, each green as the operator steps onto it; the steps after
         the focus map appear orange the moment it is settled (Thom,
         2026-09-28). */
      state.protocolPending = true;
      state.protocolChosen = id;
      /* Nothing said under the row: the rail says it, step by step. */
      state.protocolNote = "";
    }
  }
  state.sideMounted = null;
  page.view.fitted = false;
  page.shown.gating?.redraw();
  page.renderPointList();
  page.drawStage();
  page.renderAll();
}

/* The card renders into the channel like every other step's controls:
   cleared and rebuilt on every call, which is how its panel behaved, so
   nothing in it goes stale. */
export function renderSetup(page) {
  const state = page.run;
  if (page.step(state.activeIdx).id !== "connect") return;
  const host = page.panels[page.shownPanel()]?.channel;
  if (!host) return;
  host.textContent = "";
  const pad = document.createElement("div");
  pad.className = "side-pad";
  mountTheCard(pad, page);
  host.append(pad);
}

/** The session card lives in the channel like everything else: it is the
    controls of the step being stood on, beside the canvas it configures the
    run for. */
export const connectChannel = {
  id: "connect",
  label: "Connect",
  rebuildsOnEveryRender: true,
  mount: (host, page) => renderSetup(page),
};
