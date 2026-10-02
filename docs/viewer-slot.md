# The viewer slot

The picture in the middle of the operator window is drawn by a **drawing engine**, and the
engine is pluggable. This page says what any engine has to offer to fill that slot, how the
interface chooses one, and what a different viewer -- a plain JPEG one, or one built on Viv --
would implement to take its place.

Three engines fill the slot today. They live in
`zmart_interface/parts/canvas/engines/`, one folder each:

| Engine | What it draws | When it is used |
|---|---|---|
| `neuroglancer-under` | the run's OME-Zarr images, served by ZMART-viewer, with neuroglancer | the picture of a connected run, by default |
| `viv-under` | the run's OME-Zarr images, read directly with Viv on deck.gl | on request (`?engine=viv-under`) |
| `jpeg-under` | one small JPEG per field, with a `tiles.json` saying where each belongs | the canvas itself: opened with no acquisition, it carries the panning, the zooming and the operator's drawings, and the acquired picture sits in its middle slot (`middleSlot`) |

"Under" names the arrangement all three share: the picture is drawn **underneath** the
operator's own drawing (the carrier, the scan fields, the focus points, the targets), which
lies on a second surface above it. The engines came from ZMART-microscopy's
`viz_studio/options/`, where they were written side by side behind one interface so that they
could be compared fairly. Merging them with ZMART-viewer's own engine is a later step.

## What an engine is

A folder holding a `viewer.js` that exports exactly one function:

```js
openViewer(element, options) → Promise<handle>
```

`element` is the box the picture fills. `options` says what to draw:

- `acquisitions` -- the run's images, as `[{ url, name, channels? }]`, drawn in order with
  the first at the bottom. Every `url` is a whole address (scheme and host included); an
  engine never works one out. `channels` may say each channel's name, colour, brightness
  window and whether it is shown; left out, the engine reads them from the image's own
  description.
- `background`, `transparentBackground` -- the page's colour, or a transparent ground so the
  drawing beneath shows through where nothing was imaged.
- `presentation: "2d-overlay"` -- the run's stacks stand on one table, every stack's lowest
  plane at z = 0.
- `onViewChanged(where)` -- called whenever the view settles.

Everything is in **micrometres on the stage**: the centre of the view, the zoom (micrometres
per screen pixel), the plane. No engine may expose its own notion of zoom, because two
engines that disagreed on units would put the same field in two places.

## What the handle must offer

These are the five things the operator page needs from any engine.

**1. Show an acquisition.** Draw what `acquisitions` names, each placed by the voxel size *and*
the position it states in its own description (two images at different voxel sizes have only
that position in common). `setChannel(index, { visible, colour, window })` changes how one
channel is drawn; `showPicture(on)` turns the whole picture off and on without closing
anything; `setPlane(z)` and `theDepthItCanShow()` step through a stack; `setMoment(t)` and
`theMomentsItCanShow()` through a time-lapse.

**2. Follow it while it grows.** A run is drawn while the microscope is still writing it.
`addSources(acquisitions)` adds the fields that have landed since -- it answers `true` when the
new list only grows the old one (the view, the colours and the brightness stay as they were),
and `false` when something was removed or replaced, so the page opens the picture again.
`tilesMayHaveLanded({ coverage })` says "go and look, a field may have arrived", with the
newest record of which ground has been imaged.

**3. Named views.** ZMART-viewer publishes, beside each acquisition, views of it that have names
-- the brightest plane of every stack (a maximum projection), the top of the stack, a slice.
They arrive in `acquisitions` as channels carrying a `view` description, and the acquisition
carries `embeddingUrl`, the address of the viewer's own `embedding.js`, which says which views
there are and which one is chosen. An engine draws a named view as a flat picture and keeps it
in view at every depth, since a projection has no depth of its own.

**4. Where the operator clicked.** The page's drawings and presses are in micrometres, so the
engine says how the screen and the stage meet: `whereThingsAreDrawn()` gives the centre, the
zoom, the box's size, and `project(x, y)` / `unproject(px, py)` between micrometres and screen
pixels, for this very frame. `getView()` and `setView({ centre, zoom })` read and move the
view. `handDragsTo(handler)` lets the page take a drag for itself (to move a focus point, say),
reported as `{ phase, at, screen }` with `at` in micrometres; handing over `null` gives
dragging back to panning.

**5. The two drawings and the two gestures.** `drawUnder(paint)` and `drawOver(paint)` each
take one function that the engine calls at the moment it considers right, with the frame it is
drawing (`centre`, `zoom`, `context`, `project`, `unproject`, ...). An engine that cannot really
draw beneath its picture says so in `drawsUnder` (`false`) and `drawsUnderBecause` (one plain
sentence) rather than faking it above. Dragging pans and the wheel zooms, for every engine,
from one shared file (`engines/gestures.js`), so a difference in how two engines feel is a
difference in the engines.

And `destroy()`, which leaves the box empty. An engine keeps nothing in module variables, so a
page can hold two at once.

## How the interface chooses one

`zmart_interface/parts/canvas/engines.js` lists the engines the page was built with and how
to load each one. The canvas the steps draw on is a `jpeg-under` opened with no acquisition;
the picture of a connected run opens on `neuroglancer-under` inside its middle slot, and
`?engine=<name>` in the page's address chooses another engine for the picture, for
comparison. A page opened straight off the disk cannot start neuroglancer's background
programs, so `enginesOnOffer()` leaves it out there and `whyOneIsMissing()` says so on the
page. An engine that is asked for and cannot be opened is named in the corner of the box, never
replaced in silence: a picture that never arrives looks exactly like one still loading.

Adding an engine is one line in `engines.js` and a folder beside the others.

## What a second viewer would implement

**A JPEG viewer** (as `jpeg-under` already is) reads small pictures made ahead of time instead
of the images themselves, so it opens a scan of ten thousand fields at once. It implements
showing, following (a field that lands is one more JPEG), and where things are drawn; it has
one plane and one moment, so `theDepthItCanShow()` and `theMomentsItCanShow()` answer `null`,
and it has no volume to show.

**A viewer built on Viv** (as `viv-under` is) reads the OME-Zarr images in the browser. It
implements everything above; named views it draws as the flat pictures the viewer published.

**Any other viewer** -- ZMART-viewer's own engine, when the two are merged -- implements
`openViewer` and the handle above, answers in micrometres, and says plainly what it cannot do
(`drawsUnder`, `canShowVolume`, each with its sentence) rather than pretending.
