/**
 * Watching a real run: the pictures the microscope is writing, on the canvas.
 *
 * The scan beneath the plan, in the same projection as the plan itself, so
 * the two are registered rather than merely near each other: the run's own
 * sources, or a folder of small pictures the address names (`?picture=`).
 *
 * Nothing on disk announces a saved tile: the images are declared at their
 * full size before any of them exists, so their description never changes.
 * The picture is therefore asked again rather than told — by the step as
 * positions land, and by a heartbeat, because a real acquisition goes on long
 * after this page's rehearsal has finished.
 */

/**
 * Open it, in the box this page hands over.
 *
 * `ctx` carries the box, the projection the plan is drawn in (so the scan
 * beneath can be put in the same one), and the page's colour lookup. Returns
 * the picture.
 */
import { openerFor } from "../../../../parts/canvas/engines.js";

export function watchTheRun(ctx) {
  /**
   * The scan itself, drawn beneath the plan by one of the drawing engines.
   *
   * A folder of small JPEGs with a `tiles.json` saying where each belongs —
   * what `zmart_interface/parts/storage/jpeg_tiles.py` makes from the files a microscope
   * exports, one per field as it lands. The backend says where its own are
   * (`viewOf`), because where a run's output is reachable is a fact about the
   * instrument's end; `?picture=<folder>` overrides it, which is how a run
   * served from somewhere else is looked at. Nothing is opened while neither
   * names a folder, because an engine is a large thing to fetch and a page
   * with no scan to draw has no use for one.
   *
   * Which engine draws it is `?engine=`, and the default is the JPEG one.
   * Every engine is reached through `openerFor`, the one interface they all
   * sit behind, so swapping in neuroglancer is choosing a different name and
   * changes nothing here.
   *
   * ## The view is not shared, it is handed down
   *
   * The plan's canvas owns the gestures and this follows it. That is a
   * deliberate choice between two arrangements that look equally reasonable:
   * both surfaces could listen and each move the other, and then a drag would
   * be answered twice and the two would argue about rounding for ever. One
   * listens, one follows, and they cannot disagree.
   *
   * The two speak different dialects of the same thing, and converting between
   * them is the whole of the wiring. The plan places a point in the carrier's
   * frame at `x * scale + tx` browser pixels; the engine places it at
   * `width/2 + (x - centre) / zoom`. Setting `zoom = 1 / scale` and the centre
   * to whatever puts the middle of the box in the same place makes the two
   * projections identical, which is why the scan sits under the plan rather
   * than merely near it.
   */
  const thePicture = (() => {
    const search = new URLSearchParams(location.search);
    const host = ctx.pictureHost;
    let viewer = null;
    let opening = false;
    let checkingForGrowth = false;
    let latestSources = null;
    let readingSources = null;
    let applyingSources = null;
    let updateRequested = false;
    let generation = 0;
    /* What the open viewer was opened on, so a change — the run growing a
       second kind of scan — is noticed and the viewer reopened over it. */
    let openedOn = null;
    /* The names of the acquisitions the open picture draws. */
    let openedNames = [];
    let inStageFrame = true;
    let panel = null;
    /* The one way the picture is drawn: every acquisition as its projection,
       so a stack lies flat beside the single planes. */
    const PROJECTION = "projection";
    /* What the shared viewer calls that product: the method it computed,
       which for the operator is always the maximum over the stack. */
    const THE_VIEWERS_PRODUCT = "max";
    /* Whether the run has published a product for the picture to draw. */
    let hasProducts = false;
    let embedding = null;
    let embeddingUrl = null;
    /* The stacks taken to focus before each target are evidence, not
       picture: they come in hidden, and their eye shows them. */
    const HIDDEN_AT_FIRST = ["target-focussing"];
    const requestedPanelState = {
      acquisitions: new Map(HIDDEN_AT_FIRST.map((name) => [name, false])),
      channels: new Map(),
      collapsed: new Map(),
      selectedKey: null,
      lastMismatch: null,
    };

    /* Every address that materially shapes a Viewer acquisition.  Smart
       Viewer puts the position stores on the channel rows, not beside the
       acquisition.  Leaving those addresses out made a growing run look
       unchanged after its first field, so the engine never received fields
       two through nine. */
    const addressesIn = (acquisitions) => acquisitions.flatMap((acquisition) => {
      const channelSources = (acquisition.channels ?? []).flatMap(
        (channel) => channel.sources ?? [],
      );
      return channelSources.length ? channelSources : [acquisition.url];
    }).filter(Boolean);

    /**
     * What there is to draw, asked fresh each time.
     *
     * Two answers, in order of preference: a store the address named
     * (`?picture=`, taken as it is); and the run's own OME-Zarr sources,
     * served by the viewer beside the bridge — the real picture, every
     * acquisition type a source of its own. The backend's JPEG copies are
     * not a third: the canvas opened on them first and reopened on the
     * sources a moment later, a picture changing under the operator for
     * nothing. `?engine=` still overrides the engine, so the comparisons
     * stay askable.
     */
    async function readSources() {
      if (readingSources) return readingSources;
      const session = generation;
      const reading = Promise.resolve().then(() => ctx.viewerSources?.()).then(sources => {
        if (session === generation && sources != null) latestSources = sources;
      });
      readingSources = reading;
      try { await reading; }
      finally { if (readingSources === reading) readingSources = null; }
    }

    async function whatToOpen() {
      const picture = search.get("picture");
      if (picture) {
        return {
          engine: search.get("engine") ?? "jpeg-under",
          acquisitions: [{ url: picture, name: picture.split("/").filter(Boolean).pop() ?? "scan" }],
          signature: `picture:${picture}`,
          inStageFrame: false,
        };
      }
      const sources = latestSources;
      // An unavailable response is not an instruction to remove loaded images.
      if (sources == null && viewer) return null;
      if (sources?.length) {
        const url = sources.find(a => a.channels?.some(c => c.view))?.embeddingUrl;
        if (url && url !== embeddingUrl) {
          embedding = await import(/* @vite-ignore */ url);
          if (embedding.EMBEDDING_API_VERSION !== 1) throw new Error("Unsupported viewer embedding API");
          embeddingUrl = url;
        }
        hasProducts = sources.some(acquisition => acquisition.channels?.some(c => c.view));
        const selectedSources = sources.map(acquisition => {
          if (!acquisition.channels?.some(c => c.view)) return acquisition;
          const layers = acquisition.channels.map(c => ({ ...c, group: acquisition.name }));
          const choice = embedding.viewChoices(layers)[0];
          /* An acquisition whose projection is not published yet has nothing
             to draw; it joins the picture when the product lands. */
          if (!choice.keys.includes(THE_VIEWERS_PRODUCT)) return { ...acquisition, channels: [], url: undefined };
          const selected = embedding.selectedViews(layers, { [choice.id]: THE_VIEWERS_PRODUCT });
          const channels = layers.filter(row => embedding.inSelectedView(row, selected));
          return { ...acquisition, channels, url: channels[0]?.sources[0] };
        });
        /* The engine draws acquisitions in the order supplied, first at the
           bottom. The overview is the base map and focussing is the local
           diagnostic overlay whose eye must make pixels appear and disappear,
           so keep that overlay last without changing any Viewer acquisition,
           channel, or source. */
        const drawOrder = [
          ...selectedSources.filter(({ name }) => name !== "focussing"),
          ...selectedSources.filter(({ name }) => name === "focussing"),
        ];
        return {
          engine: search.get("engine") ?? "neuroglancer-under",
          acquisitions: drawOrder,
          signature: `sources:${JSON.stringify(drawOrder.map(acquisition => [
            addressesIn([acquisition]),
            (acquisition.channels ?? []).map(channel => channel.sourceRevisions ?? []),
          ]))}`,
          inStageFrame: true,
        };
      }
      return ctx.connected?.() ? {
        engine: search.get("engine") ?? "neuroglancer-under",
        acquisitions: [], signature: "sources:", inStageFrame: true,
      } : null;
    }

    async function open() {
      if (viewer || opening) return;
      opening = true;
      const session = generation;
      try {
        if (!search.has("picture")) await readSources();
        const wanted = await whatToOpen();
        if (!wanted || session !== generation) return;
        const openViewer = await openerFor(wanted.engine);
        if (session !== generation) return;
        const opened = await openViewer(host, {
          acquisitions: wanted.acquisitions,
          presentation: "2d-overlay",
          transparentBackground: true,
          // NG's colour setting accepts RGB; its separate flag clears alpha.
          background: ctx.css("--screen"),
        });
        if (session !== generation) {
          opened.destroy();
          return;
        }
        viewer = opened;
        openedOn = wanted.signature;
        openedNames = wanted.acquisitions.map(({ name }) => name);
        inStageFrame = wanted.inStageFrame;
        /* Left where a test can reach it. What matters about a picture is what
           reached the screen, and a viewer that reports itself perfectly opened
           while drawing nothing is the failure this project keeps meeting — so
           the tests photograph the box, and this is only the way to ask it
           where it is looking. */
        window.__thePicture = viewer;
        followTheStage();
        /* The viewer's own controls — the acquisitions and their channels —
           in the column the page keeps for them beside the step's channel
           (the display settings, a tab away), or beside the picture when the
           page keeps no such column. Only for the run's own sources: a JPEG
           copy has no channels to offer. */
        panel?.destroy?.();
        panel = null;
        if (wanted.signature.startsWith("sources:")) await mountPanel(wanted, session);
        if (session !== generation) return;
        ctx.displayChanged?.();
      } catch (e) {
        console.error(`the scan could not be opened — ${e.message}`);
      } finally {
        if (session === generation) opening = false;
      }
    }

    async function mountPanel(wanted, session) {
      const { mountViewerPanel } = await import("../../../../parts/canvas/viewer-panel.js");
      if (session !== generation) return;
      const mounted = await mountViewerPanel(host.parentElement ?? host, {
        viewer, acquisitions: wanted.acquisitions, css: ctx.css,
        requestedState: requestedPanelState,
        into: ctx.displayHost?.() ?? null,
        changed: () => ctx.displaySettingsChanged?.(),
      });
      if (session !== generation) mounted.destroy();
      else {
        panel = mounted;
        /* What the row over the picture asks: whether there is a product to
           draw, and which way it is drawn. There is one way. */
        panel.element.viewModes = () => hasProducts ? [PROJECTION] : [];
        panel.element.viewMode = () => PROJECTION;
      }
    }

    /** Put the scan where the plan is looking, exactly. */
    function followTheStage(stageView = null) {
      if (!viewer) return;
      /* The same two numbers the picture above is drawn with, handed over as
         they are. This used to be worked out from a pan offset and a scale, in
         a second piece of arithmetic that had to agree with the first; when the
         picture above moved to the shared canvas those numbers stopped existing
         and the scan quietly drew nowhere. Asking for the view is one answer
         instead of two. */
      /* A view-change callback carries the committed new view. Asking the
         stage engine for it again from inside that callback can return the
         previous frame and makes this picture visibly lag during zooming. */
      const v = stageView ?? ctx.view();
      if (inStageFrame && v?.centre) {
        const [ox, oy] = ctx.carrierOriginUm();
        viewer.setView({ ...v, centre: { x: v.centre.x + ox, y: v.centre.y + oy } });
        return;
      }
      viewer.setView(v);
    }

    /** Append positions and acquisition rows without retiring loaded images.
        Only removal or replacement of sources needs a different scene. */
    async function reopenIfTheRunGrew({ refresh = true } = {}) {
      if (!viewer || opening) return;
      const session = generation;
      if (refresh) {
        try { await readSources(); }
        catch (error) {
          console.error(`the scan could not be updated — ${error.message}`);
          return;
        }
      }
      if (session !== generation) return;
      updateRequested = true;
      if (checkingForGrowth) return applyingSources;
      checkingForGrowth = true;
      applyingSources = (async () => {
        while (updateRequested && session === generation) {
          updateRequested = false;
          await applyLatestSources(session);
        }
      })();
      try { await applyingSources; }
      finally { if (session === generation) checkingForGrowth = false; }
    }

    async function applyLatestSources(session) {
      try {
        const wanted = await whatToOpen();
        if (session !== generation || !wanted || wanted.signature === openedOn) return;
        // Stop the old panel's indexed measurements before rows can move.
        const sameRows = await panel?.sourcesChanged(wanted.acquisitions);
        if (session !== generation) return;
        if (panel && !sameRows) {
          panel.destroy();
          panel = null;
        }
        if (wanted.signature.startsWith("sources:")
            && openedOn?.startsWith("sources:")
            && await viewer.addSources?.(wanted.acquisitions)) {
          if (session !== generation) return;
          openedOn = wanted.signature;
          openedNames = wanted.acquisitions.map(({ name }) => name);
          followTheStage();
          if (!panel) await mountPanel(wanted, session);
          if (session !== generation) return;
          /* New rows -- a fresh acquisition's channels -- are new display
             settings for everything drawn with them: the page is told, the
             way it is when the settings first come. */
          ctx.displayChanged?.();
          return;
        }
        if (session !== generation) return;
        closePicture();
        await open();
      } catch (error) {
        console.error(`the scan could not be updated — ${error.message}`);
      }
    }

    function closePicture({ forgetVisibility = false } = {}) {
      generation += 1;
      opening = false;
      checkingForGrowth = false;
      latestSources = null;
      readingSources = null;
      applyingSources = null;
      updateRequested = false;
      panel?.destroy?.();
      panel = null;
      ctx.displayChanged?.();
      viewer?.destroy?.();
      viewer = null;
      openedOn = null;
      openedNames = [];
      window.__thePicture = null;
      if (forgetVisibility) {
        hasProducts = false;
        requestedPanelState.acquisitions.clear();
        HIDDEN_AT_FIRST.forEach((name) => requestedPanelState.acquisitions.set(name, false));
        requestedPanelState.channels.clear();
        requestedPanelState.collapsed.clear();
        requestedPanelState.selectedKey = null;
        requestedPanelState.lastMismatch = null;
      }
    }

    return {
      /** Whether this page was pointed at a scan by its own address. The run's
          sources are asked for asynchronously, so they do not answer here. */
      get asked() { return !!search.get("picture"); },
      /** Whether there was a scan there to open, and it opened. */
      get opened() { return !!viewer; },
      /** Whether the picture draws the acquisition of this name itself. A
          layer that would print copies of it asks first: the engine's own
          pixels answer to the display settings, copies laid over them would
          not. */
      shows(name) { return openedNames.includes(name); },
      open,
      followTheStage,
      reopenIfTheRunGrew,
      /** A field has landed, so there may be more of the scan to read. */
      mayHaveLanded() {
        if (openedOn?.startsWith("sources:")) return reopenIfTheRunGrew();
        viewer?.tilesMayHaveLanded?.();
      },
      /** The session is over, and what was opened belongs to it. A reconnect
          is a fresh session: its run starts with nothing scanned, and the
          picture of the last one must not stand in for it. */
      reset() { closePicture({ forgetVisibility: true }); },
    };
  })();

  /* Opened at once when the page was pointed at a scan. It is not opened lazily
     on the first draw, because the first draw is also the first thing an
     operator sees, and a picture that arrives a moment after everything else
     reads as the page having stumbled. */
  thePicture.open();

  // Open an empty viewer after Connect, then poll for published sources and
  // refresh existing ones. There is no separate step-4/step-5 viewer lifecycle.
  setInterval(() => {
    if (thePicture.opened) {
      /* And whether the run has grown a source the open viewer does not
         hold — the targets landing beside the overview, say. The check is
         one small request, and nothing happens while the answer is the one
         already open. */
      thePicture.reopenIfTheRunGrew();
    } else {
      /* Asked even when the page's own address names nothing: the run's
         sources appear only once something has been captured, and the page
         cannot know when that is without asking. */
      thePicture.open();
    }
  }, 1500);

  return { thePicture };
}
