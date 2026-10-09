# The workflows: one folder each, and the folder's name is its name

Every folder in here that contains a `flow.js` is a workflow the operator can
choose. The folder's name is what the chooser at the top left of the window
shows — underscores read as spaces, first letter capitalised, so
`target_acquisition` appears as **Target acquisition**. A flow whose folder
rule would come out wrong may say its own name instead (`export const name`),
for an acronym the rule would lower-case. Adding a workflow means adding a
folder with a `flow.js` in it; nothing else in the interface has to change,
because the framework finds these folders by looking
(`../framework/rules/finding-workflows.js` says how).

There is one built into the page today:

- **`target_acquisition/`** — a run on a microscope that has already been set
  up: find the targets on an overview and acquire them.

A workflow does not have to live in this folder, or in this repository. One
written elsewhere is built into a small package and installed on a computer
with `zmart_interface.register_workflow`; the page there offers it without
being rebuilt. `../../docs/writing-a-workflow.md` says how, and the
framework's own fixture, `../framework/fixtures/three_steps/`, is one written
that way.

Setting a microscope up -- its travel limits, which way the picture is turned,
how the objectives line up, and where its coordinates count from -- is done
once per microscope with that microscope's driver, and is not a workflow of
this interface (see the README).

## What is inside a workflow's folder

```
target_acquisition/
  flow.js        the front door: the steps, in order, plus a sentence for the
                 chooser. Open this first — it is the whole workflow in one
                 screenful.
  steps/         one folder per step, connect/ to run_protocol/. Each holds
                 the step's declaration (step.js); what the step does when it
                 is run (run.js); the controls it docks in the channel beside
                 the canvas (channel.js); and, where the step shows something
                 of its own, a file named for what that is — overview.js,
                 gate.js, gallery.js — rather than for the kind of thing it is.
  shared/        what several steps of this workflow use: the carrier geometry,
                 the scan-field arithmetic, the layers the run draws, and the
                 small things they share on the page (page-helpers.js).
  the-canvas.js  what the workflow puts on its canvas: the stage picture, the
                 live picture of the run, the axes under them.
  on-the-page.js how the workflow is wired to the page when it opens: the
                 canvas, and the functions its steps lend the page.
```

The microscope seam is a part, not the workflow's: `../parts/microscope/`
holds `live.js`, which speaks to the bridge, and `mock.js`, the in-browser
rehearsal used by some of the page's own tests. Every call to the instrument
lives behind that seam — a step only calls it and awaits.

The rule that decides where a file goes: **put it beside the things that use
it, at the lowest folder that covers them all.** Used by one step → in that
step's folder. Used by several steps of one workflow → that workflow's
`shared/`. Used by any workflow → `../parts/`.

## Borrowing steps instead of retyping them

A step belongs to the workflow that owns it, and other workflows import it;
`target_acquisition/flow.js` is little more than the list in `the-run.js`.
A workflow that wants a borrowed step to say something different wraps it in
`reworded()` (from `../framework/rules/steps.js`), which changes the wording and
nothing else. That keeps what a step *does* written down once, so a fix
reaches every workflow at the same moment.

## What a step is made of

A step is data, not code: a short description the framework reads. These are its
fields, all optional except the first two.

- `id` — the short name the page files this step's result under.
- `title` — what the step is called in the rail down the left.
- `why` — one sentence saying what the step is for.
- `panels` — which modules the step wants on screen, named. An empty list means
  "nothing of my own"; see `../framework/rules/steps.js`, which decides what that
  comes to once the canvas is in play.
- `btn` — the words on the button that carries the step out. A step with no
  `btn` has nothing to press: some steps are completed by doing the thing they
  are about — the carrier is settled by being configured, the scan fields by
  being drawn — and asking for a press afterwards would only ask the operator
  to confirm what they have already done.
- `ownButton` — the step's own panel builds its button, so the framework should not
  add a second one underneath.
- `ms` — how long the page waits before a step with no `run` of its own
  counts as finished: the rehearsal's pace, for a step whose work is done
  when its press is released.
- `mode` — what kind of work the step is about: `focus`, `scan`, `detect`,
  `targets`, and so on. The layers drawn on the picture read it to decide what
  to draw while this step is being looked at.
- `run(page, step, options)` — what the step does when its press is pressed:
  it calls the backend and answers a promise. Nothing back means the run
  finished; `{ stopped: true, note }` means the operator's hand put it down,
  with the sentence to say beside the press; `{ failed: why }` means it failed
  and has already said so in its own box. A run that throws is a failure the
  page reports. `options` is what a second press hands over, such as the one
  tile to take again.
- `finished(page, step)` — called once a run finished: where the step files
  what it came to, its note and whatever the next step now works with.
- `brake(page)` — how a running step is stopped, when it can be: the press
  becomes Interrupt while the step runs, and this is what it does.
- `again` — the words on the press once the step has run, instead of
  "Run again".
- `rerunCurrent(page)` — for a step that can take one item again: answers a
  function that gives `run` its `options`, or `null` when there is nothing
  current. The page then offers a "Rerun current" press before the main one.
- `pressed(page)` — what the press does for a step that does not run through
  the page at all, because it runs the other steps: Run protocol.
- `running(run)` — whether such a step is running, for the rail's spinner.
- `runsTheOthers` — this step walks the other steps in turn (Run protocol is
  the one today). The framework keeps the walk's own state in
  `page.run.protocol` and reads whether it is running; a step that says this
  is never left orange or done by an edit above it, since it has no settings
  of its own to confirm, and its `brake` is what the walk's Interrupt
  presses.
- `beside(run, { done })` — the sentence beside the press once nothing blocks
  it, instead of the step's note.
- `noHint` — nothing stands beside the press: what the step waits for and
  what it came to are in its own box.
- `afterThePress(host, page)` — anything else the step puts beside its press.
- `channel` — the step's controls in the column beside the canvas:
  `{ id, label, mount(host, page, { locked }) }`. Mounted once per step and
  kept, so a field being typed into is never destroyed; a channel that
  `rebuildsOnEveryRender` says so.
- `arrived(page)` — what the step does to the picture when the operator
  arrives on it: which layers to show, which acquisition to hide.
- `settledByStanding(page)` — for a step with no press: standing on it is
  what settles it, and this says what that means.
- `ready` — what the step still needs before it may be carried out. It is
  handed the run so far and answers either `null`, meaning go ahead, or a short
  phrase saying what is missing, which the page shows beside the greyed-out
  button. A step with no rule is always ready. Readiness belongs to the step
  rather than the page around it: only the focus step knows what a focus map
  needs, and putting the rule on the step is what lets a new workflow be a list
  of steps instead of another rule added to the shell.
- `note` — what the step writes beside itself in the rail once it has finished,
  for steps whose result is always the same sentence.
- `nothingWaitsOnThis` — the steps after this one do not wait for it. A run is
  walked in order because each step usually produces something the next one
  needs; a step that only shows the operator something produces nothing to wait
  for, and saying so here lets them walk straight past it. See
  `../framework/rules/steps.js`, which is where the rule lives.

## What a step's run is handed: the page

Every hook above takes `page` first. It is the one object the whole window
shares, built in `../framework/window/main.js`, and it carries everything a
step may need: `page.run`, the run document (the framework's keys from
`../framework/window/run-state.js`, the workflow's from its own
`freshState`); `page.backend`, the seam to whatever the workflow drives;
`page.flow()`, the open workflow as assembled, and `page.steps()`;
`page.panels`, one entry per panel built, with what its `build` handed back
(for target acquisition `page.stage` and `page.drawStage()` come from there
through its `install`); `page.shown`, the handles of the boxes a workflow's
steps put on screen; the page's render functions (`renderAll`, `renderRail`,
`renderActionBar`); `page.stateEdited(id)`, the one call every edit goes
through; and the functions the steps lend one another (`page.surfaceZAt`,
`page.pictureOf`, ...). A step reaches the rest of the page only through it,
which is what lets each step live in its own folder.

The page also carries five hook lists, each an array a workflow's `install`
pushes a function to, which is how the framework calls back into a workflow
it knows nothing about:

- `page.onRender` — called after every full render.
- `page.onPanelShown` — called with the step and the panel's key whenever a
  panel is drawn.
- `page.onReset` — called when the run starts over: on Disconnect, or when
  another workflow is chosen. Target acquisition stops its stage clock here
  and asks for the instruments again.
- `page.onChannelMounted` — called with the channel's host and the step's
  channel after the step's controls were mounted. Target acquisition puts
  the protocol's progress over them.
- `page.onThemeChanged` — called when the page's theme switches, for
  whatever chose its colours itself.

## What a flow is made of

`flow.js` exports `steps` (the list) and `blurb` (the sentence), and may also
export any of these. Every one is optional: a workflow of plain steps that
drives nothing and keeps nothing of its own needs only the first two.

- `name` — the chooser's entry, when the folder rule would misname it (an
  acronym, mostly).
- `panels` — what the workflow puts on screen: the canvas, or a panel of its
  own. A panel is `{ key, label, stays, build(host) }`; the framework builds
  one element per key and the panel fills it through `build`, handing back
  whatever the steps need of it (`channel`, `foot`, ...). A panel that draws
  something of its own may also answer `shown()`, which the framework calls
  when the panel comes on screen or its room changes, since a hidden box has
  no size to draw into.
- `opensFirst` — the workflow a fresh page opens on.
- `install(page, { folder })` — how the workflow wires itself to the page,
  once, the first time a run of it begins: as the page opens on it, or when
  the operator chooses it. `page.run` is then a run of this workflow, with
  its own `freshState` keys in place. Target acquisition opens its canvas
  here and lends its steps' functions to the page. This is also where a
  workflow pushes to the page's hook lists (below). `folder` is the name the
  workflow is installed under; since the hooks are called for every
  workflow's run, a hook that reads this workflow's own keys or asks its
  backend first checks that it is the one open, `page.run.wf === folder`.
  The panels, by contrast, are built for every workflow when the page opens,
  so what a workflow draws on them is wired once and kept.
- `backendFor(search)` — which backend the steps speak to, given the page's
  own address (a `URLSearchParams`): target acquisition answers the bridge, or
  the in-browser rehearsal for `?backend=pretend`. A workflow that drives
  nothing leaves this out and is handed an empty object.
- `freshState({ backend })` — the workflow's half of the run document: every
  key its steps read, with the value it has before anything was done. The
  framework lays these beside its own keys (which step is active, what is
  done, what is running — `../framework/window/run-state.js`), so a step
  finds both on `page.run`. The framework's keys cannot be overwritten.
- `keptAcrossSessions` — which of those keys survive a disconnect or a change
  of workflow. Target acquisition keeps the session and the list of
  instruments, since editing them is the reason to disconnect.
- `forTests(state)` — what a browser test may read of the workflow's state,
  through `window.__theRunState()`, beside the framework's own fields.

The framework's own fixture, `../framework/fixtures/three_steps/flow.js`,
is the smallest flow that exercises all of these; read it next to this list.
