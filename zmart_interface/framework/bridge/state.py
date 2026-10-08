"""The bridge's ledgers: the open session, the run folder, and what every run has done so far.

One module owns every fact the bridge keeps between two requests, so that
the other modules read and write the same thing and none of them has to
know which thread last touched it. Each is a plain module attribute and is
read through this module (``state.session``, never a copied name), so a
value one module sets is the value the next one sees.

The ledgers are dictionaries updated in place: ``focus`` for the focus map,
``scan`` for the overview scan, ``targets`` for discovery, ``acquired`` for
the target run, ``plots`` for the population plots. ``records`` keeps every
capture by the interface's own name for its acquisition (overview,
focussing, targets, ...), which no driver reports: the bridge stamps it on
each record from what it asked for.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import threading
from pathlib import Path

from zmart_interface.parts.microscope.instrument import Instrument

#: The one lock that guards the instrument. Every route that touches the
#: session takes it first, so two requests can never move the stage at once.
the_instruments_turn = threading.Lock()

#: The open microscope, or None: the controller's session, read through
#: :class:`Instrument` so every answer is a report. One at a time: the window
#: is one operator at one instrument.
session: Instrument | None = None

#: How the driver was chosen; filled by connect, shown by /api/connect replies.
context: dict = {}

#: The stage's last known position, in ``get_xyz``'s shape: what the page's
#: clock is answered with while a run holds the instrument's turn.
last_xyz: dict | None = None

#: This session's run folder: ``<output root>/target-acquisition_<hash6>``,
#: made at connect. Everything a session captures goes under it, which is what
#: makes one run a run -- without it every scan piles into the same folder and
#: the second is indistinguishable from the first.
run: Path | None = None

#: Where runs go, when this bridge was started with somewhere to put them.
#: A driver that discovers its own (the Leica finds the root beside LAS X)
#: needs none of this; one that cannot has to be told, and the page has
#: nowhere to say it -- it connects with the entry the list offered.
output_root: str | None = None

#: The synthetic specimen that stands in for the LAS X simulator's pixels,
#: when the bridge was started with ``--simulator-pixels`` and a session is
#: open; None otherwise. One per session, anchored at connect.
pixel_provider = None
simulator_pixels_enabled = False


def require_session() -> Instrument:
    """The open session, or a refusal that says what to do."""
    if session is None:
        raise RuntimeError("no session is open — connect first")
    return session


def the_run() -> Path:
    """This session's run folder, or a refusal that says what to do."""
    if run is None:
        raise RuntimeError("no run is open — connect first")
    return run


# --- what every run has done so far: one ledger each, updated in place -------

#: The focus map under way, the bridge's ledger of what the page has had
#: scored so far, in the order the page asked. Polled by a page that reopens,
#: and read by the tests that watch a map fill in.
focus = {
    "running": False, "done": 0, "of": 0, "error": None, "stopped": False,
    "points": [],
}

#: The overview scan under way or last finished: how far it is, what it has
#: captured, and the centres it was planned over.
scan = {
    "running": False, "done": 0, "of": 0, "error": None, "stopped": False,
    "acquisition_type": None, "records": [],
    "planned": [],
}

#: Discovery under way, polled by the page the way the scan is. Each field is
#: appended as its targets are found, so the page can draw them while the
#: rest of the overview is still being looked at.
targets = {
    "running": False, "done": 0, "of": 0, "error": None, "stopped": False,
    "fields": [], "failed": [], "phase": None, "objects": 0,
}

#: The target run under way, the bridge's ledger of what the page has landed
#: so far, in the order the page took it. Polled by a page that reopens.
acquired = {
    "running": False, "done": 0, "of": 0, "error": None, "stopped": False,
    "records": [],
}

#: The multidimensional plot under way or last finished, polled by the page.
plots = {
    "running": False, "kind": None, "error": None, "stopped": False,
    "kinds": [], "doing": None, "took_s": None, "of": None, "objects": None,
}

#: The operator's hand on the brake, one per procedure the bridge runs on
#: its own. Set by the stop routes, read by the workers between two fields
#: -- never mid-capture: the capture in flight completes and is kept,
#: because a field interrupted halfway is a file nobody can account for.
#: The focus map has no brake here: the page drives it, and stops itself.
stop_asked = {"scan": False, "targets": False}
plots_stop = {"asked": False}

# --- what every run captured, and the pictures made from it ------------------

#: What every scan captured, by the kind of scan. The kind -- ``acquisition_type``
#: throughout the bridge -- is the interface's own name for an acquisition
#: (overview, focussing, targets, ...), not part of the controller's contract:
#: the bridge stamps it on every record it keeps, from what it asked for, and
#: never reads it back from a driver. The overview's records are
#: what discovery reads and what its pictures are made from, and a targets
#: scan taken afterwards must not replace them -- it did, when there was one
#: list, and the overview's view filled with the targets' pictures.
records: dict[str, list] = {}

#: Copies drawn with a display, by (kind, label, the display as asked); a
#: scan start empties it, since the pixels behind a label may change.
displayed_pictures: dict[tuple, bytes] = {}

#: One view-builder at a time, and only when the scan has grown: every file
#: request used to rebuild the whole view, and two rebuilding at once
#: interleaved their writes into a corrupt note that failed every request
#: after it. ``view_built`` says how many records each kind's view was last
#: built from.
view_lock = threading.Lock()
view_built: dict[str, int] = {}
