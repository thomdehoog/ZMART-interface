# Writing a workflow in another repository

The interface's framework runs any workflow it is handed, and knows none in
particular. That means a workflow does not have to live in this repository:
you can write one in a repository of your own, build it into a small package,
and install that package on any computer that has the interface. The page
there offers your workflow in its chooser the next time it opens, without
being rebuilt, and you can hand the same package to a colleague whose
microscope PC also has the interface.

This page says how. It assumes you have read `zmart_interface/workflows/README.md`,
which explains what a step and a flow are made of; nothing about writing the
steps themselves changes because they live elsewhere.

## What your repository holds

A workflow is a folder with a `flow.js` in it. Beside it go whatever the
workflow needs -- its steps in folders of their own, shared code, a piece of
markup read in as text -- and a `workflow.json` describing the package:

```
my_workflow/
  flow.js            the front door: the steps, the blurb, the panels, install, ...
  workflow.json      what the package is called and which framework it was written for
  steps/
    begin/step.js
    ...
```

`workflow.json`:

```json
{
  "folder": "my_workflow",
  "name": "My workflow",
  "version": "1.0.0",
  "framework": "^0.1.0",
  "bundle": "flow.bundle.js",
  "python": "my_workflow_bridge"
}
```

- `folder` is the name the workflow is installed under on a computer, one
  plain folder name; the chooser shows `name`.
- `version` is yours.
- `framework` is the range of interface versions the workflow was written for,
  in the usual shorthand: `^0.1.0` means 0.1.x, `>=0.1.0 <0.3.0` a span, `*`
  anything. The page refuses a package written for a framework it is not, with
  a sentence in its console and a greyed entry in the chooser, rather than
  running it and failing somewhere in the middle. The interface's version is in
  its `package.json`.
- `bundle` is the built file, `flow.bundle.js` unless you say otherwise.
- `python` is optional: the module of your Python half, if the workflow has
  one (below).

## What a workflow may import, and how

Your code imports the framework and the parts by one bare name,
`zmart-interface/<path under zmart_interface/>`, never by a relative path
into a checkout of the interface:

```js
import { sideGroup } from "zmart-interface/framework/window/panels.js";
import { el, css } from "zmart-interface/framework/window/dom.js";
import { status } from "zmart-interface/framework/window/status.js";
import { atBridge } from "zmart-interface/framework/window/bridge-address.js";
import { reworded } from "zmart-interface/framework/rules/steps.js";
import { canvasPanel } from "zmart-interface/parts/canvas/panel.js";
```

A dynamic `import("zmart-interface/parts/canvas/engines.js")`, for a heavy
part you only want when a step needs it, is answered the same way.

The page answers these at run time from its own modules, so your workflow
uses the very same framework and parts as the workflows built into the page,
whichever version of the interface the computer has. What is on offer:

- the framework's helpers a step reaches for: `framework/window/dom.js`,
  `framework/window/panels.js`, `framework/window/status.js`,
  `framework/window/bridge-address.js` and `framework/rules/steps.js`;
- every part under `parts/`: the canvas and its drawing engines, the
  microscope seam (`parts/microscope/live.js` speaks to the bridge), the
  recordings and instruments helpers, and so on;
- every built-in workflow's shared code and step declarations,
  `workflows/<name>/shared/*.js` and `workflows/<name>/steps/<step>/step.js`.

About that last group, a limit you should know before you lean on it. A
built-in step brings its declaration, not the wiring its own workflow does in
`install`: target acquisition's steps reach the page's `stage`,
`listInstruments` and the rest, which exist only once target acquisition has
been opened on the page. So a step can be borrowed into a workflow written
elsewhere only if it uses nothing its owner lends -- none of target
acquisition's ten does today. Letting a step declare its own wiring is the
next cut; until then, use the shared helpers and write your steps afresh.

Anything else -- a library of your own, a file beside your flow, a piece of
markup read in as text with `?raw` -- is imported by a relative path as usual
and is folded into your bundle by the build. Two things are not folded in.
A stylesheet your code imports comes out of the build as `style.css` beside
the bundle; fetch it from the package's folder and put it on the page from
your `install`:

```js
const style = document.createElement("link");
style.rel = "stylesheet";
style.href = atBridge("/workflows/my_workflow/style.css");
document.head.append(style);
```

And a picture larger than Vite folds inline becomes a file address the
loaded bundle cannot follow; keep pictures small, or fetch them from the
package's folder the same way.

One more detail of how the loading works: the page hands your bundle each
framework module's exports as they stand when the bundle loads. Nothing in
the framework reassigns an export after that, so this never shows, but a
future module that did would not be seen changing.

The framework's own fixture, `zmart_interface/framework/fixtures/three_steps/flow.js`,
is a complete workflow written this way: three steps, a card panel, no
microscope. Start from it.

## Building the package

The build needs a checkout of the interface with its npm packages installed
(`npm ci`, see `docs/building-the-page.md`), because it uses the interface's
own Vite. From anywhere:

```bash
node <interface checkout>/zmart_interface/framework/build/workflow-bundle.mjs  <your workflow folder>  <out folder>
```

The out folder then holds `flow.bundle.js` -- your flow and everything it
imports by a relative path, folded into one module, with every
`zmart-interface/...` import left as written -- and a copy of your
`workflow.json`. That folder is the package. Commit it to your repository or
zip it; it is what you hand to a colleague.

## Installing it on a computer

On the computer that runs the interface, in the environment the interface is
installed in:

```powershell
python -c "import zmart_interface; print(zmart_interface.register_workflow(r'C:\path\to\the\package'))"
python -m zmart_interface.framework.bridge --workflows
```

The first copies the package into the computer's workflow library,
`zmart-interface\workflows` under the ZMART folder
(`C:\ProgramData\zmart-microscopy` on Windows, or wherever
`ZMART_MICROSCOPY_ROOT` points; `ZMART_WORKFLOW_LIBRARY` names another folder
outright), beside the saved protocols, and prints the folder it is installed
as. A package missing something is refused with a sentence saying what, and
nothing is copied. The whole folder you point at is copied, so point at the
built package, not at your repository's root. The second lists what is
installed. Installing a package again replaces the earlier one; to remove
one, delete its folder from the library.

The next time the operator page opens, its chooser offers the workflow. The
page itself was not rebuilt and not changed: the bridge lists the library
(`GET /api/workflows`), the page fetches each bundle and points its imports
at the page's own modules, and the workflow joins the ones built in.

## A Python half

A workflow that needs the computer to do something the page cannot -- read a
file, drive an instrument, run an analysis -- gives the bridge a Python
module. Name it in `workflow.json` as `"python"`; it has to be importable
from the environment the bridge runs in (install it with `pip`, or put it on
the path). The module defines one function:

```python
def routes(register):
    """Add this workflow's routes to the bridge, under /api/<folder>/."""
    register("GET", "hello", say_hello)
    register("POST", "count", count_to)


def say_hello(asked, query):
    return {"hello": "world"}


def count_to(asked, query):
    to = int(asked.get("to", 3))
    if to < 0:
        raise ValueError("counting to a negative number is not something I can do")
    return {"counted": to}
```

The bridge imports the module when it starts and calls `routes`. Each route
lands under `/api/<folder>/`, so the two above answer `GET /api/my_workflow/hello`
and `POST /api/my_workflow/count`. A handler is written the way the bridge's
own are: it takes the request's JSON body as a dictionary (empty for a GET)
and the raw query string, and answers a dictionary; an exception it raises
reaches the page as a sentence, with status 400 for a `ValueError`.

Two things follow from the bridge loading Python halves only as it starts.
A package installed while the interface is running is listed with the
sentence "restart the interface to finish installing it" until it is
restarted. And a package's folder may not be one of the names the bridge
uses for its own routes (`instruments`, `connect`, `xyz`, `acquire` and the
others under `/api/`) nor the folder of a workflow built into the interface
(`target_acquisition`): such a package would replace their routes, so its
Python half is not loaded and the chooser says why.

The workflows built into the interface have a Python half the same way, in
`zmart_interface/workflows/<folder>/bridge/`; Target acquisition's is the
complete example to read, with its own routes for the focus map, the scans,
finding and taking the targets, the plots and the protocols.

## What a Python half may tell the bridge

The bridge's general part knows no workflow, so a half that runs things on
its own tells the bridge about them, in `zmart_interface.framework.bridge.hooks`:

```python
from zmart_interface.framework.bridge import hooks

hooks.plug(
    "my_workflow",
    holds_the_stage=lambda: my_scan["running"],  # while true, nothing else drives the stage
    let_go=stop_and_wait,                        # before another session opens: stop between fields
    forget=reset_my_ledgers,                     # when a fresh session opens
    raw_kinds={"my-stacks"},                     # view folders served as they are
    picture_endings={".mask.png": draw_a_mask},  # pictures drawn on request, by name
)
```

Each is optional. `let_go(wait_s)` is called without holding the
instrument's lock, because a run needs that lock to finish its field.

The run folder the bridge makes at connect is named by the page:
`backend.connect(session, { experiment: "my-workflow" })` makes
`<output root>/my-workflow_<hash>`.

From the page, your steps reach them at the bridge's address, which
`zmart-interface/framework/window/bridge-address.js` knows:

```js
import { atBridge } from "zmart-interface/framework/window/bridge-address.js";

const answer = await fetch(atBridge("/api/my_workflow/count"), {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: 3 }),
});
const { counted } = await answer.json();
```

A handler runs on the bridge's request thread with no lock held. If your
half drives the instrument through the controller, take the bridge's lock
around that work yourself, `with zmart_interface.framework.bridge.state.the_instruments_turn:`,
so two requests never move the stage at once; the bridge's own routes do the
same.

A module that fails to import, or has no `routes`, leaves the workflow listed
with the error, and the page says so and does not offer it: a workflow whose
routes are missing would fail in the operator's hands instead.

## What stays the interface's

The framework, the parts, the bridge's own routes and the built page are the
interface's and change with its releases; your package says which releases
it was written for. The parts are not yet published as separate packages,
and the runtime is not versioned on its own: a workflow is written against an
interface version, and that is what `framework` in `workflow.json` names.
