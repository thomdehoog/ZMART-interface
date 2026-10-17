# Why it is built this way

`architecture.md` says what is where. This says why, and what to keep to
when it changes. If a change needs one of these rules broken, change the rule
here first, on purpose, and the check that enforces it with it.

The interface is maintained by a code agent and signed off by someone who does
not read the code. So it is checked by machines, explained in plain words, and
laid out so that anyone can see where a thing belongs.

## Every piece of code in its place

**Three layers, and the framework knows nothing.** The framework is an empty
frame: the rail, the panels, the press, the runner, the HTTP door. It runs any
workflow and knows none -- an image-analysis workflow or an e-learning course
would run in it unchanged. Adding a workflow is writing its folder; if it
means editing the framework, the framework is missing something.

**The oven test.** Could this module serve a workflow that has nothing to do
with a microscope -- a course on cleaning an oven, say? If not, it is not a
part. A module that passes still starts inside the workflow that needs it,
and moves to `parts/` when a second workflow needs it too, not before. That
is why `parts/` is empty.

**A workflow is self-contained.** Everything about the microscope and the
controller lives in the workflow, its Python half included: the bridge's
routes, the mock microscope, the storage, the analysis. Copy the folder into
another interface and it runs. Workflows share nothing with each other; a
workflow uses only the workflow API and the npm packages the interface lists.

**What belongs together sits together.** A module is one folder with one job,
and files that change together live in it. A step is a folder: its
declaration, its run, its controls, what it draws, and its tests. A step
imports no other step; what several steps use goes in the workflow's
`shared/`, and nothing there imports a step. Every test stands beside what it
tests.

**One owner per fact.** Every fact has one home and everything else reads it
there. If a rule has to appear in two files, the split was wrong: merge them,
rather than keeping two copies in step.

**Ties are straight.** One direction everywhere, no cycles. Plain function
calls with plain data. No side doors (`window.__*`) in the page's own code;
those are for the tests to look in, never for one part of the page to reach
another.

## What is true

**Only the mock driver pretends.** The page, the bridge and the controller
hold nothing invented: no made-up positions, heights, pixels or cells. If the
real microscope answered instead of the mock, none of them would see a
difference. What the stage mark shows is what the instrument reported.

**The controller's contract is the fixed point.** The interface adapts to
the contract; drivers fill it. A field in it is something any microscope can
honestly report. One vendor's shapes never become the contract.

**A run stops between items.** Interrupt ends a run between two points, tiles
or targets. Nothing asks the microscope to stop what it is doing.

## Writing the code

- **The best code is the code you didn't write.** When a structure looks
  wrong, first ask whether it needs to exist at all.
- **Clean, not patched.** A fix is structural: the code looks as if it was
  always designed this way. No workarounds, no special cases bolted on, no
  compatibility shims or "legacy" flags unless asked for.
- **No bloat.** No wrapper, layer or helper the code does not need; no helper
  that only forwards to another; no two functions doing the same thing.
- **Smallest clean design.** Choose by how the microscope is actually used,
  not by elegance. Turn a real rule into an enforced one (a check, a type, a
  refusal) rather than building flexibility nobody uses. Never claim a rule
  without enforcing it.
- **Plain names.** No `_names`, `_files` or `_folders`. A name says what the
  thing holds; what a module exports says what is public.
- **The why in words.** Every file opens with a short description of what it
  is for. Comments say why, not what. Extensible beats short: a named helper
  with a sentence beats a clever one-liner.
- **Strict types.** TypeScript, strict, everywhere in the page. A type says
  what is true -- a value that can be missing is typed as missing, not cast
  past.

## Changing it: the rules for a refactor

1. **No new bloat.** Types where they carry an agreement; no wrapper, layer
   or helper the code did not need before.
2. **Existing bloat goes.** Dead code, unused exports, duplicated logic,
   helpers that only forward, comments that repeat the code -- removed in the
   same change.
3. **What belongs together sits together.** Move code to where it is used;
   one folder, one job.
4. **A sound direction.** Workflows use only the API and npm packages; the
   framework uses no workflow; no cycles.
5. **Finish the move.** No half-migrated shapes, where part of the code
   follows the new layout and part the old. No fossils: a parameter nothing
   reads, a field nothing uses, a branch that is never taken.
6. **The operator sees no change** unless the change was meant. A refactor
   moves code; what is on the screen stays as it was.

And for every change, refactor or not:

- **Test first.** A test that fails for the right reason, then the code that
  makes it pass. The test asserts real values, not only that nothing crashed.
- **One change, one commit**, with the files named.
- **When a test and the page disagree, decide which is right.** A test that
  fell behind a decision is changed to the decision; a page that broke a
  promise is fixed. Neither is changed just to make the other pass.
- **The checks pass**: types (`tsc`), imports (`check:imports`), dead code
  (`knip`), the API (`check:api`), the unit tests, and the operator walk on
  the built page. The machines say where a rule was broken; nobody has to
  remember.
- **The API changes only with its version.** `api/report.txt` and the frozen
  fixture hold it there.

## Where each rule is enforced

| rule | enforced by |
| --- | --- |
| the framework knows no workflow; workflows share nothing; a step imports no step; no cycles | dependency-cruiser, `.dependency-cruiser.cjs` |
| no dead code or unused exports | knip |
| the API does not change under its version | `npm run check:api`, the frozen fixture |
| a workflow fits the API it names | the build, against `workflow.json` |
| types say what is true | `tsc --noEmit`, strict |
| the page does what the operator expects | the Playwright specs and the walk |

The rest -- the oven test, one owner per fact, only the mock pretends -- is
held by review, against this page.
