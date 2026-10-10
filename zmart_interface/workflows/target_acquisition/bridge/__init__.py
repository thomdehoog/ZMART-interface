"""Target acquisition's Python half: its routes, and what it tells the bridge.

The bridge's general part connects, drives the stage, captures and serves
the pictures; it knows no workflow. Everything Target acquisition runs on
top of that lives here:

- ``focus``: the focus map, driven by the page one stack at a time;
- ``scan``: the overview scan, run in the bridge's own thread;
- ``discovery``: finding the targets in the overview, through the analysis;
- ``plots``: the population table and its multidimensional plots;
- ``targets``: the target run, driven by the page one tile at a time;
- ``protocols``: the settings a run ran with, and the ones saved by name;
- ``ledgers``: how far each of those runs has got;
- ``views``: the pictures only this workflow draws (focus slices, masks).

Its routes are registered by :func:`routes` under ``/api/target_acquisition/``,
the same way an installed workflow's are (``framework/bridge/workflows.py``).
Importing this package plugs the workflow into the bridge (``hooks.py``):
its runs may hold the stage, it lets them go before another session opens,
it forgets them when a fresh one does, and it draws its own pictures.

Its routes, and what they are made of
-------------------------------------

Each path below is under ``/api/target_acquisition/``.

* ``POST focus/begin``, ``POST focus/score`` and ``POST focus/end``
  — the focus map, driven by the page one stack at a time: begin clears the
  focussing acquisition and names the stacks; the page drives (``/api/xyz``)
  and captures (``/api/acquire``) each; score files the stack, scores it and
  answers the point; end closes the map. ``POST focus/stop`` is the
  operator's Interrupt reaching a scoring that has hung: it puts the analysis
  workers down, so that scoring answers. ``GET focus/measure`` is the
  bridge's ledger of the points scored so far.
* ``POST targets/acquire/begin``, ``POST targets/acquire/focus``,
  ``POST targets/acquire/landed`` and ``POST targets/acquire/end``
  — the target run, driven by the page one tile at a time like the focus
  map: begin clears the targets acquisition (unless appending) and names the
  captures; the page drives and captures each, with a focussing stack first
  when the operator asked for one (``focus`` scores it under its own
  acquisition and answers the peak); landed files the target's record the
  way the scan filed its own; end closes the run. ``GET targets/acquire``
  is the ledger, ``?since=N`` the records after the ones a page holds.
  ``POST targets/raise`` puts one acquired target's frame on top of its
  neighbours in the picture.
* ``POST plots/compute`` — a multidimensional plot (``pca`` or ``umap``)
  over the detected population, or the ids named, through ZMART-analysis;
  ``GET`` reads its progress, ``POST plots/compute/stop`` puts it down,
  ``GET plots/columns?kind=`` answers its two columns by id.
* ``POST scan`` — start the overview scan in a background thread: drive
  to each position, acquire, report progress. ``GET scan`` reads the
  progress. The window's live picture watches the run's own store, so nothing
  here needs to push pixels at the browser.
* ``POST scan/stop`` and ``POST targets/discover/stop`` — the
  operator's Interrupt: ask the run to stop between two fields. What was
  captured stands; the answer is the run as it stood, ``stopped`` set once
  the worker has honoured it.
* ``POST targets/discover`` — find the targets in the overview's fields,
  all of them or the ones named, through the warm analysis; ``GET`` reads the
  progress, each field's targets appended as they are found.
* ``GET protocols`` and ``POST protocols`` — the protocols this
  machine has written, before and after connecting; ``POST protocol``
  writes the run's settings beside it, ``POST protocol/save`` into the
  machine's library by name.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import time
import urllib.parse

from zmart_interface.framework.bridge import connecting, hooks
from zmart_interface.parts.microscope.focus_run import FOCUSSING

from . import discovery, focus, ledgers, plots, protocols, scan, targets, views

#: How long letting the last session go waits for the running scan to finish
#: the field it is capturing. A field is never cut off halfway, and one slow
#: field (a deep stack) can take minutes; beyond this the operator is told to
#: try again.
WAIT_FOR_THE_LAST_SCAN_S = 600.0


def let_go(wait_s: float | None = None) -> None:
    """Stop the scan and discovery between two fields, and wait until they have.

    Both run in the bridge's own threads and outlive the page that started
    them, so another session must not open beneath them. The focus map and
    the target run are driven by the page itself, so a reloaded page has
    already let them go; connecting forgets their records.
    """
    if ledgers.scan["running"]:
        scan.stop_scan()
    if ledgers.targets["running"]:
        discovery.stop_targets()
    limit = time.monotonic() + (WAIT_FOR_THE_LAST_SCAN_S if wait_s is None else wait_s)
    while ledgers.scan["running"] or ledgers.targets["running"]:
        if time.monotonic() > limit:
            raise RuntimeError(
                "the scan that was running has not stopped yet; it finishes the field it is "
                "capturing first, so wait a moment and connect again"
            )
        time.sleep(0.05)


hooks.plug(
    "target_acquisition",
    holds_the_stage=ledgers.a_run_has_the_stage,
    let_go=let_go,
    forget=ledgers.forget,
    raw_kinds={FOCUSSING},
    picture_endings={".mask.png": views.the_mask_view_for, ".labels.png": views.the_label_map_for},
)


def since(query: str) -> int | None:
    """The ``since=N`` a ledger is read from, when the page has part of it already."""
    asked = urllib.parse.parse_qs(query or "").get("since", [None])[0]
    return int(asked) if asked is not None else None


def routes(register) -> None:
    """Every route of the workflow, each ``register(method, path, handler)``.

    ``handler(asked, query)`` takes the request's JSON body and the raw query
    string, as the bridge's own routes do. The paths are under
    ``/api/target_acquisition/``.
    """
    # The focus map: the page drives each point and ends the map.
    register("POST", "focus/begin", lambda asked, query: focus.begin_focus(asked))
    register("POST", "focus/score", lambda asked, query: focus.score_focus(asked))
    register("POST", "focus/stop", lambda asked, query: focus.stop_focus())
    register("POST", "focus/end", lambda asked, query: focus.end_focus(asked))
    register("GET", "focus/measure", lambda asked, query: dict(ledgers.focus))
    # The overview scan, run here and polled by the page.
    register("POST", "scan", lambda asked, query: scan.start_scan(asked))
    register("GET", "scan", lambda asked, query: scan.the_scan(since(query)))
    register("POST", "scan/stop", lambda asked, query: scan.stop_scan())
    # Finding the targets, run here and polled by the page.
    register("POST", "targets/discover", lambda asked, query: discovery.discover_targets(asked))
    register("GET", "targets/discover", lambda asked, query: discovery.the_targets(since(query)))
    register("POST", "targets/discover/stop", lambda asked, query: discovery.stop_targets())
    # The population plots.
    register("POST", "plots/compute", lambda asked, query: plots.compute_plot(asked))
    register("GET", "plots/compute", lambda asked, query: dict(ledgers.plots))
    register("POST", "plots/compute/stop", lambda asked, query: plots.stop_plot())
    register("GET", "plots/columns", lambda asked, query: plots.plot_columns(
        urllib.parse.parse_qs(query or "").get("kind", [""])[0]))
    # The target run: the page drives each tile and ends the run.
    register("POST", "targets/acquire/begin", lambda asked, query: targets.begin_target_run(asked))
    register("POST", "targets/acquire/focus", lambda asked, query: targets.score_target_focus(asked))
    register("POST", "targets/acquire/landed", lambda asked, query: targets.target_landed(asked))
    register("POST", "targets/acquire/end", lambda asked, query: targets.end_target_run(asked))
    register("GET", "targets/acquire", lambda asked, query: targets.the_target_run(since(query)))
    register("POST", "targets/raise", lambda asked, query: targets.raise_target(asked))
    # Protocols: before connecting, the chosen microscope's saved connection
    # says where earlier runs are.
    register("GET", "protocols", lambda asked, query: protocols.protocols())
    register("POST", "protocols", lambda asked, query: protocols.protocols(
        connecting.saved_connection(asked["instrument"]) if asked.get("instrument") else None))
    register("POST", "protocol", lambda asked, query: protocols.save_protocol(asked))
    register("POST", "protocol/save", lambda asked, query: protocols.save_protocol_to_library(asked))
