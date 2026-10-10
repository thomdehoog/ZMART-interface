# Plan: the background program knows no workflow

*Status: a plan to be read and reviewed. Nothing has moved yet.*

## In short

The interface has two halves: the **page** you see, and the **background
program** (the "bridge") that talks to the microscope. Your rule is that
the general part of the interface knows nothing about any one workflow;
each workflow brings what it needs. The page already keeps that rule. The
background program does not: the code for focus maps, the overview scan,
finding targets, plots, taking the targets and protocols (everything
*Target acquisition* does) sits in its general part.

This plan moves that code into the Target acquisition workflow's own
folder, so that the general part only knows how to connect to a
microscope, move the stage, read and apply settings, capture, show
pictures, and keep the page safe. A second workflow then starts from that
general part without inheriting Target acquisition's code, and Target
acquisition can change without touching what every workflow shares.

### What you would notice

At the microscope: **nothing.** The same steps, the same buttons, the same
files on disk. Runs keep their folder name (`target-acquisition_xxxxxx`),
so every protocol saved so far is still found.

For whoever writes a workflow: the background program offers the same
small set of services to every workflow, documented in one place, and
Target acquisition is an ordinary user of them, an example to copy.

### What it costs

The internal addresses the page uses for Target acquisition change (for
example `/api/scan` becomes `/api/target_acquisition/scan`). A page and a
background program from before and after the change cannot be mixed; both
ship together in one package, so on a microscope this only matters if
someone runs an old page against a new install. Many tests move with the
code (listed below). The work is done in steps that each leave everything
working, with the tests green after every step.

### Decisions for you

1. **The addresses change** as described above. The alternative, keeping
   `/api/scan`, would need a special exception for the built-in workflow,
   which is exactly the kind of exception the rule forbids. Recommended:
   change them.
2. **Two more things in the general part are not about Target acquisition
   but about one instrument:** the mock microscope (always offered first,
   and its window opened by the general part) and the LAS X simulator's
   synthetic pixels. The same rule says they belong elsewhere: the mock
   with the mock, the simulator option with the simulator. Recommended:
   include them, as the last step, so the general part is clean in one go.
   They can also be left for later.
3. **The run folder's name.** Today the general part fixes it as
   `target-acquisition`. Recommended: the page says which workflow it is
   running when it connects, and Target acquisition says
   `target-acquisition`, exactly as today.

## The steps

Each step is one or a few commits on `release-candidate`, written test
first, with the targeted tests green after it and the full suites run
once at the end. Nothing in a step changes what the operator sees.

### Step 1: give the general part the hooks a workflow needs

No code moves yet; the general part learns to be told things instead of
knowing them.

- **Built-in workflows can have a Python half too.** Today only workflows
  installed from another repository can. `framework/bridge/workflows.py`
  also looks for `zmart_interface/workflows/<folder>/bridge/` with a
  `routes(register)` function, and registers its routes under
  `/api/<folder>/`, the same mechanism and the same prefix. This needs
  `__init__.py` files in `workflows/` and `workflows/target_acquisition/`.
- **"A run has the stage."** `stage.a_run_has_the_stage()` reads four
  Target acquisition records by name. Instead, a workflow registers a
  question ("is one of my runs driving the stage?"), and the general part
  asks every registered one. The stage clock, connecting and starting a
  scan keep their behaviour.
- **What happens on connect, on a fresh session and on closing.** Today
  `connecting.py` stops the scan and target finding and resets their
  records by name. Instead a workflow registers what to do when another
  session is about to open (stop between two fields and wait: called
  outside the instrument's lock, as now, or connecting would deadlock),
  and what to forget when a fresh session opens. Closing the window calls
  the same hooks.
- **The run folder's name comes from the page.** `POST /api/connect`
  takes `experiment`, checked with `output.checked_name`; a page that
  sends none gets a general default.
- **Pictures a workflow makes.** The picture route special-cases focus
  slices and detection masks. Instead a workflow registers which kinds of
  picture it serves and how (raw files for a kind, a handler for a name
  ending such as `.mask.png`).
- **The reserved folder names** (`THE_BRIDGES_OWN`) are taken from the
  general routes only, plus the names of the built-in workflows.

### Step 2: move the Python half of Target acquisition

`focus.py`, `scan.py`, `discovery.py`, `plots.py`, `targets.py` and
`protocols.py` move from `framework/bridge/` to
`workflows/target_acquisition/bridge/`, with their records (the focus,
scan, targets, acquired and plots ledgers and the stop flags) taken out of
`state.py`. They register their routes, their "has the stage" question,
their hooks and their picture kinds from step 1. `server.py` loses its 25
Target acquisition routes; `connecting.py` loses `EXPERIMENT` and the
named resets.

What stays general: connecting, the stage, readings and settings,
capturing, the run folder, keeping each capture as an OME-Zarr position,
display copies, the viewer, installed workflows, and the safety checks.
The analysis adapters in `parts/analysis` (focus scoring, detection, mask
pictures) stay where they are: they are general tools that only Target
acquisition uses so far, and a shared part may be used by one workflow.

### Step 3: split the page's backend the same way

`parts/microscope/live.js` and `mock.js` (shared parts) also carry Target
acquisition's verbs (measuring the focus map, scanning, finding and taking
targets, plots, protocols). The general verbs (connect, the stage,
settings, capture, pictures) stay; the Target acquisition verbs move to
`workflows/target_acquisition/backend/` and call the new addresses.
`flow.js` already chooses the backend for the workflow (`backendFor`), so
it composes the general backend with its own verbs and the framework
changes nothing. `backend-contract.js` keeps its 12 general promises; the
4 Target acquisition ones move with the workflow. The built page is
rebuilt. An installed workflow that imported one of the moved verbs from
`parts/` must import it from the workflow instead; the framework's version
is raised and `docs/writing-a-workflow.md` says so.

### Step 4: keep it so

A Python test, the twin of `framework/knows-no-workflow.test.js`, refuses
any module under `framework/bridge/` that imports from `workflows/`, from
`mock_microscope`, or names a Target acquisition word. The page's test is
widened from `window/` and `rules/` to the whole framework.
`docs/architecture.md` (the "knows no workflow" sentence, which becomes
true), `workflows/README.md` and `docs/writing-a-workflow.md` describe the
result.

### Step 5 (decision 2): the mock and the simulator out of the general part

- The mock microscope is offered by whoever starts the interface (the
  launcher and the standalone bridge pass it in as an extra driver, shown
  first), not named by the general part; it opens its own window from its
  own connect.
- The LAS X simulator's synthetic pixels (`--simulator-pixels`,
  `KidneyPixels`) become an option the simulator setup passes in, not a
  flag of the general part.

## Tests that move or change

Counted on `release-candidate` as of this plan:

- `framework/test_operator_bridge.py`: 80 tests, 56 about Target
  acquisition. These move to the workflow; the 22 general ones stay; 2
  mixed ones are split.
- `test_stopping_a_focus_map.py` moves; `test_connecting_again.py` (3 of
  5), `test_names_from_the_page.py` (2 of 4), `test_nothing_is_guessed.py`
  (1 of 6) and `parts/storage/test_canonical_previews.py` (2 of 3) are
  split; `test_workflow_library.py`'s list of routes and
  `test_installing_safely.py`'s example of a reserved name change.
- Page tests: `live-acquire`, `live-focus-chain`, `live-plots` and
  `live-targets` move with the verbs; `backend-contract` is split.
- Browser tests: `walk.spec.js`, `transparent-middle.spec.js`,
  `the-scan-the-page-takes.spec.js`, `step-five-view-preservation.spec.js`
  (through `live-bridge.js`) and one stub in `operator-page.spec.js` follow
  the new addresses.
- Several tests replace module functions by their path (for example
  `scan.output.move_record_images`); those paths change with the move.

## Risks, and how each is met

- **A page and a background program of different ages.** Both are in one
  package; the committed page is rebuilt in step 3 and the build check
  (`test_the_built_page.py`) fails until it is.
- **Connecting while a scan runs.** The let-go hook must run outside the
  instrument's lock, as now; `test_connecting_again.py` holds that.
- **Saved protocols.** The run folder name stays `target-acquisition`, so
  `protocols()` finds every earlier run; a test pins it.
- **Installed workflows.** Their Python halves keep the same mechanism and
  prefix; only a workflow that imported a moved page verb is affected, and
  the framework version says so.
- **The walk through all ten steps** (`walk.spec.js`) needs the analysis
  environments, which this computer's group policy blocks. It is run on a
  machine that has them before the change is called done.

## For reviewers

Questions worth an outside opinion:

1. Are the hooks in step 1 (routes, "has the stage", let go / forget on
   connect, picture kinds, the experiment name from the page) the right
   and smallest set, or does one of them hide a second workflow's need
   that is not visible yet?
2. Should the page send the run folder's name at connect, or should the
   workflow's Python half declare it?
3. Is it right that the analysis adapters (`focus_score`, `detection`,
   `mask_view`) stay shared, although only Target acquisition uses them?
4. Step 5: is "the starter passes the mock in as an extra driver" cleaner
   than registering the mock with the controller's driver registry, which
   writes to the machine's settings?
5. Is there a cheaper way to keep old addresses working for a while, and
   is that worth it, given that page and background program always ship
   together?
