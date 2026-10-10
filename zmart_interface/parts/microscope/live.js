/**
 * The seam where the microscope goes — the live side of it.
 *
 * The same shape as `mock.js`, implemented as HTTP calls to the bridge
 * (the package `zmart_interface/framework/bridge/`), which speaks to the ZMART
 * Controller, which speaks to whichever driver is plugged in — a real
 * microscope's driver on the microscope PC, or the interface's own mock
 * microscope on a machine with no instrument.
 *
 * Everything about the wire lives in this one file: the address, the JSON,
 * and how a failure becomes a thrown Error carrying the bridge's own
 * sentence. Nothing else in the page knows HTTP exists.
 *
 * **This is the backend the page runs on.** Open it and it speaks to the
 * bridge; which driver the controller runs behind that — the mock or a real
 * microscope — is chosen on the Connect step, and either way every verb goes the
 * whole way through the controller and a driver. The in-browser rehearsal in
 * `mock.js` is reachable only by `?backend=pretend`, and only this page's own
 * browser tests ask for it.
 *
 * These are the verbs every workflow shares. A workflow's own verbs (Target
 * acquisition's focus map and scans, say) live with the workflow and borrow
 * the helpers exported here (`ask`, `askedPatiently`, `capturedBy`, `rest`);
 * the workflow's `flow.js` puts the two together.
 */

/* Where the bridge answers is the page's one fact about its own address
   (`framework/window/bridge-address.js`): the page's own origin on the
   microscope, or `?bridge=http://127.0.0.1:8600` during development, when
   the vite server holds the page instead. Re-exported here, since every
   picture address this seam hands out is built with it. */
import { atBridge } from "../../framework/window/bridge-address.js";
export { atBridge };

import { PENDING, isFailed } from "./connection-status.js";

/** One call to the bridge: JSON in, JSON out, failure as a plain sentence. */
export async function ask(route, payload) {
  const body = await request(route, payload);
  if (body.error) throw new Error(body.error);
  return body;
}

async function request(route, payload) {
  const answer = await fetch(atBridge(route), payload === undefined
    ? undefined
    : {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  const body = await answer.json().catch(() => ({}));
  if (!answer.ok) {
    throw new Error(body.error ?? `the bridge answered ${answer.status}`);
  }
  return body;
}

export const rest = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The content inside the controller's answer to `acquire`, or the driver's
 * reason as a plain sentence when the microscope declined. The bridge passes
 * the controller's `{success, content}` on untouched, so the page reads a
 * capture exactly as a Python script does.
 */
export function capturedBy(answer) {
  if (answer?.success === true) return answer.content;
  const content = answer?.content;
  const reason = typeof content === "string" ? content : content?.reason ?? content?.message;
  throw new Error(`the microscope could not capture an image: ${reason ?? "the driver gave no reason"}`);
}

/**
 * Ask again through a rough patch. A poll's dropped fetch is not the run
 * failing: the instrument keeps going whether or not one request lands, and
 * a busy bridge declared a healthy 864-field scan "failed" over one hiccup.
 */
export const askedPatiently = async (path) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await ask(path);
    } catch (why) {
      if (attempt >= 3) throw why;
      await rest(700);
    }
  }
};

/** How often the connection's health is asked for while it is still answering. */
export const POLL_MS = 250;

export const backend = {
  /**
   * Where a scan's pictures can be fetched, or `null` for a backend with none.
   *
   * A microscope writes OME-TIFFs, which a browser cannot open and which are
   * far too heavy to send; the bridge makes one small JPEG per field as it
   * lands and serves them here, with a `tiles.json` beside them saying where
   * each belongs. The backend answers this rather than the page working it
   * out, because where a run's output is reachable is a fact about the
   * instrument's end and nothing the page could know.
   */
  viewOf(acquisitionType) {
    return atBridge(`/view/${acquisitionType}`);
  },

  /** What can be connected to: the interface's list of microscopes, from the bridge. */
  async instruments() {
    return (await ask("/api/instruments")).instruments;
  },

  /**
   * The OME-Zarr pictures of this run, in Smart Viewer's own grouping: one
   * entry per acquisition, one channel entry per Viewer layer, and every
   * spatial store retained in that channel's `sources` list.  This shape is
   * load-bearing — nine fields of a three-channel overview are three channel
   * controls backed by nine sources, not twenty-seven controls.
   *
   * `null` while the Viewer is not up or holds nothing yet; the page then
   * falls back to the JPEG copies, so a machine without the Viewer installed
   * draws exactly as it always has.  The `sources` fallback keeps this page
   * able to speak to an older bridge during a rolling update.
   */
  async viewerSources(onStatus) {
    try {
      // A successful status response can contain both available images and a
      // failed acquisition. Its error must not discard the available images.
      const state = await request("/api/viewer");
      onStatus?.(state);
      if (Array.isArray(state?.acquisitions) && state.acquisitions.length) {
        return state.acquisitions;
      }
      const all = [];
      for (const sources of Object.values(state?.sources ?? {})) {
        for (const source of sources) all.push({ url: source.url, name: source.name });
      }
      return all.length ? all : null;
    } catch (why) {
      onStatus?.({ error: `Viewer status unavailable: ${why.message}` });
      return null;
    }
  },

  /**
   * Open the session through the bridge, then watch the driver's own
   * connection checks answer.
   *
   * The driver reports its health in `get_info().connection_status`: ordered
   * keys, each `"pending"` until answered, a value beginning `failed` when a
   * check failed. This polls that until nothing is pending. The keys go out
   * through `onChecks` on the first read, so the window can put every
   * question on screen before any answer exists; each answer lands through
   * `onCheck(index, value)` once, as it turns up. Resolves with the driver's
   * info once every check has answered; rejects, naming the check, when one
   * has failed.
   */
  async connect(session, { onChecks, onCheck, experiment } = {}) {
    /* The password travels with the connection: a gate that demanded it and
       then discarded it authenticated nothing. What a driver does with it is
       the driver's business. `experiment` is what the workflow calls its
       runs: the bridge makes the run folder `<experiment>_<hash>`. */
    await ask("/api/connect", {
      instrument: session?.instrument, password: session?.password, experiment,
    });
    let keys = null;
    const answered = new Set();
    for (;;) {
      const info = await this.info();
      const status = info.connection_status ?? {};
      if (keys === null) {
        keys = Object.keys(status);
        onChecks?.(keys);
      }
      let pending = false;
      let failure = null;
      keys.forEach((key, k) => {
        const value = status[key];
        if (value === PENDING) { pending = true; return; }
        if (!answered.has(key)) {
          answered.add(key);
          onCheck?.(k, value);
          if (isFailed(value)) failure ??= `${key}: ${value}`;
        }
      });
      if (failure) throw new Error(failure);
      if (!pending) return { info };
      await rest(POLL_MS);
    }
  },

  /** Close the session at the bridge, so the next connect is not refused. */
  async disconnect() {
    await ask("/api/disconnect", {});
  },

  /** The driver's account of the session: `get_info` through the controller. */
  async info() {
    return ask("/api/info");
  },

  /** Where the stage is: `get_xyz` through the controller. */
  async get_xyz() {
    return ask("/api/xyz");
  },

  /**
   * Drive the stage there: `set_xyz` through the controller, answering with
   * `get_xyz` afterwards. One route, the method saying which of the two is
   * meant, and the same two names the controller uses.
   */
  async set_xyz({ x, y, z }) {
    return ask("/api/xyz", { x, y, z });
  },

  /**
   * What the instrument offers for a capture, and what is chosen now:
   * `get_acquisition_settings` through the controller. A readout — asking
   * changes nothing — and handed on in the driver's own words, because the
   * same shape goes back to `acquire`.
   */
  async get_acquisition_settings() {
    return ask("/api/acquisition_settings");
  },

  /**
   * Change settings on the instrument: `set_state` through the controller,
   * answering with what the driver says it applied — which is not always what
   * was asked, since a value it will not take is the driver's to refuse.
   *
   * Nothing on the page calls this, by decision: the page reads what it is
   * told and leaves the choosing to the software that authors the recipes.
   * It is here because the seam mirrors the controller's surface.
   */
  async set_state(settings) {
    return ask("/api/state", settings);
  },

  /**
   * A readout, never a procedure: the instrument's state as it is set now.
   * One `get_state` through the controller, shaped by the bridge into the
   * reading the window records. `nth` is the pretend operator's knob and the
   * live instrument has no use for it: the instrument is read as it stands,
   * set up in its own software -- LAS X, or the mock instrument window.
   */
  async readSetting(type) {
    return ask(`/api/setting?type=${encodeURIComponent(type)}`);
  },

  /**
   * Capture once where the stage is standing: `acquire` through the
   * controller, answering as the controller does — `{success, content}`, the
   * content's `files` naming every file saved and its `planes` which channel,
   * depth and stage position each picture is. The one place a client learns
   * the paths of the files a run made.
   *
   * `folder` is the page's own name for the acquisition this capture belongs
   * to (overview, focussing, targets, ...), not part of the controller's
   * contract. The bridge offers it to the driver as its `folder` acquisition
   * setting when the driver has one, so the pictures of one acquisition stay
   * together on disk.
   */
  async acquire({ position_label, acquisition_settings = null, folder = null }) {
    return ask("/api/acquire", { position_label, acquisition_settings, folder });
  },

};
