# Dropping a workflow in

The interface's framework runs any workflow it is handed, and knows none in
particular. A workflow is one folder under `zmart_interface/workflows/`. To add
one -- written here or in a repository of your own -- copy or clone its folder
there, add what it needs to the interface's own dependency lists, and build the
page again. The page then offers it in its chooser. To take one out, remove
its folder and build again.

This page says how. It assumes you have read `zmart_interface/workflows/README.md`,
which explains what a step and a flow are made of.

## What the folder holds

A workflow is a folder with a `flow.js` in it. Beside it go whatever the
workflow needs -- its steps in folders of their own, shared code, a stylesheet,
a piece of markup read in as text -- and, if it has one, its Python half:

```
my_workflow/
  flow.js            the front door: the steps, the blurb, the panels, install, ...
  steps/
    begin/step.js
    ...
  bridge/            its Python half, a package (optional; below)
    __init__.py
```

The folder's name is the workflow's name in the chooser, and the first part
of its routes at the bridge (`/api/my_workflow/...`).

## What a workflow may import

A workflow imports its own files, and the framework and the parts by a
relative path: `../../framework/window/panels.js` from its `flow.js`. It does
not import another workflow: a piece two workflows need is general and moves
into `parts/`.

The framework's helpers a step reaches for are `framework/window/dom.js`,
`framework/window/panels.js`, `framework/window/status.js`,
`framework/window/bridge-address.js` and `framework/rules/steps.js`; every
part under `parts/` is on offer: the canvas and its drawing engines, the
microscope seam (`parts/microscope/live.js` speaks to the bridge), the
recordings and instruments helpers, and so on.

The framework's own fixture, `zmart_interface/framework/fixtures/three_steps/flow.js`,
is a complete workflow: three steps, a card panel, no microscope. Start from it.

## Its dependencies

An npm package the workflow imports goes into the interface's `package.json`
(`npm install <package>` in the interface's checkout); a Python package its
half imports goes into the interface's `pyproject.toml`. There is one page and
one Python environment, so there is one list of each.

## Building

```bash
npm run build
```

`docs/building-the-page.md` says what that needs. The built page in
`zmart_interface/build/` now holds the workflow; commit it, and install the
interface on the microscope PC as usual (`docs/install-on-a-microscope.md`).

## A Python half

A workflow that needs the computer to do something the page cannot -- read a
file, drive an instrument, run an analysis -- gives the bridge a Python half:
a package `bridge/` in its folder that defines one function:

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

The bridge imports every workflow's half when it starts and calls `routes`.
Each route lands under `/api/<folder>/`, so the two above answer
`GET /api/my_workflow/hello` and `POST /api/my_workflow/count`. A handler is
written the way the bridge's own are: it takes the request's JSON body as a
dictionary (empty for a GET) and the raw query string, and answers a
dictionary; an exception it raises reaches the page as a sentence, with status
400 for a `ValueError`. A half that fails to import stops the bridge, saying
why.

A half may also answer bytes (a picture, a file), refuse with a status of its
own, take every path under a prefix, and take part in starting and closing the
interface: its own command-line options, what it does at start (which may name
the window), and what it closes at the end. All of that is
`zmart_interface/framework/bridge/api.py`, the one module of the framework a
half imports.

Target acquisition's half, `zmart_interface/workflows/target_acquisition/bridge/`,
is the complete example to read, with its own routes for the focus map, the
scans, finding and taking the targets, the plots and the protocols.

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

From the page, your steps reach the routes at the bridge's address, which
`framework/window/bridge-address.js` knows:

```js
import { atBridge } from "../../framework/window/bridge-address.js";

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
