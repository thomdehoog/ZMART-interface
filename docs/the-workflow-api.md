# The workflow API

The agreement between a workflow and the interface that runs it. A workflow is
a folder under `zmart_interface/workflows/`; this page says what it may use of
the interface, what it declares for the interface to run it, and when the
interface calls what it declares. The types are in `zmart_interface/api/index.ts`;
this page is their explanation.

## Its edge

A workflow imports three things: its own files, `zmart_interface/api/index.ts`,
and the npm packages listed in the interface's `package.json`. Anything else
stops the build with a sentence naming the import (dependency-cruiser). Two
workflows share nothing, not even a panel.

Its Python half (`<folder>/bridge/`) imports of the interface only
`zmart_interface/framework/bridge/api.py`, and reaches its own folder by
relative imports, so the folder works under any name.

## Its version

`zmart_interface/api/version.json` holds the API's version, `API_VERSION` in the
types. Each workflow states the versions it works with in its own
`workflow.json`:

```json
{ "name": "target_acquisition", "version": "0.1.0", "api": "^0.1.0" }
```

The build, and the development server as it starts, stop with a sentence when
a workflow's range does not include the API's version, or when a workflow has
no `workflow.json`. While the API is at 0.x, every minor raise means editing
each workflow's range; that is intended. From 1.0.0, adding a hook or an
optional field is a minor raise; a new required field, a changed argument, a
changed default type or a changed moment of calling is a major one.

## What a workflow may use

- `API_VERSION`.
- The helpers a step reaches for: `el(id)`, `css(name)` and `sizeCanvas(canvas)`
  (the page's DOM and its colours), `sideGroup(title)` (one box down the
  channel), `status` (the bar's sentence), `atBridge(route)` (a route on the
  bridge as an address the page can fetch), `editedAt` and `staleSteps` (the
  rules about orange steps).
- `ThemeVar`: the page's base colours and measures, as CSS custom properties.

## What a workflow declares

`flow.js` (or `flow.ts`) exports, every one optional but the first two:

| export | what it is |
| --- | --- |
| `steps` | the steps, in order (`Step`) |
| `blurb` | the chooser's sentence |
| `name` | the chooser's entry, when the folder's name would misname it |
| `panels` | what it puts on screen (`Panel`) |
| `opensFirst` | the workflow a fresh page opens on |
| `install(page)` | how it wires itself to its page; answers `{ lends, hooks }` |
| `backendFor(search)` | what its steps speak to, given the page's address |
| `freshState({ backend })` | its keys of the run document, as a fresh run holds them |
| `keptAcrossSessions` | which of those keys survive a disconnect |
| `forTests(run)` | what a browser test may read of them |

A step's fields, a panel's, a channel's and the hooks are written out in
`zmart_interface/workflows/README.md` and typed in `api/index.ts`
(`Step`, `Panel`, `Channel`, `Hooks`).

`WorkflowTypes` is one bag a workflow fills in -- its `state`, `backend`,
`lends`, `shown` and its steps' own fields -- so `Page<W>`, `Run<W>` and
`Step<W>` speak of its own. `framework/fixtures/three_steps/flow.ts` does it
for the smallest workflow that uses every field and hook.

## What the page offers a step

`Page<W>`: `run` (the run document), `backend`, `panels`, `shown`, `steps()`,
`step(i)`, `indexOfStep(id)`, `activeStep()`, `renderAll()`, `renderRail()`,
`renderActionBar()`, `focusPanelsFor(i)`, `readiness(step)`,
`stateEdited(id)`, `runStep(i, options)`, `resetRun()`, `remountChannel()`,
`interruptWalk()` and `shownPanel()`, plus what the workflow lends. The
interface's own machinery (switching workflows, building pages) is not on it.

The run document is plain data. A workflow may write the framework's `done`,
`stale`, `ran`, `notes`, `activeIdx`, `walk` and `sideFolded`, and its own
keys; `wf`, `running`, `interrupting`, `failed`, `tabs`, `tab` and
`sideMounted` it only reads (`FrameworkRun`).

## When things are called

This is part of the agreement: a changed moment is a breaking change.

- `arrived(page)`: whenever the page focuses on a step (`focusPanelsFor`):
  a click in the rail, the page opening, a reset, after every run (finished
  or stopped), and wherever a walking step focuses.
- `settledByStanding(page)`: only on a click in the rail.
- `ready(run, page)`: whenever the press is drawn, and whenever a step asks
  `page.readiness(step)`.
- `run(page, step, options)`: on the step's press, or `runStep`; `finished`
  once it finished.
- `mount(host, page, { locked })`: once per step and per locked state, or on
  every render for a channel that says `rebuildsOnEveryRender`; `destroy()`
  when the channel changes hands.
- The hooks run only for the workflow that is open: `onRender` after every
  full render, `onPanelShown(step, key)` whenever a panel is drawn, `onReset`
  when the run starts over (Disconnect, or this workflow chosen),
  `onChannelMounted(host, channel)` after a step's controls are mounted, and
  `onLeave` when another workflow is chosen.

## The Python side

`zmart_interface/framework/bridge/api.py` is the one module of the framework a
Python half imports. A half defines `routes(register)`; `register(method, path,
handler, prefix=False)` puts a route under `/api/<folder>/`, and a prefix route
hands its handler the rest of the path. A handler takes the request's JSON body
and the raw query string and answers a dictionary, or `Bytes(body,
content_type)` (sent with `Cache-Control: no-store`). `Refusal(message,
status)` answers its status with the sentence; `KeyError`, `ValueError` and
`TypeError` answer 400. A half may also define `add_arguments(group)` (its own
command-line options), `start(args)` (which may answer the window's title) and
`close(wait_s)`. Handlers run on the bridge's request threads, with no lock
held. A workflow's folder name is a Python identifier.
