"""What a workflow tells the bridge, so that the bridge needs to know no workflow.

The bridge's general part connects, drives the stage, reads and applies
settings, captures, keeps each capture as an OME-Zarr position, and serves
the pictures. Everything a workflow runs on top of that -- a focus map, a
scan, finding targets -- lives in the workflow's own Python half, which
plugs into the bridge here under its own name:

- **holds_the_stage**: a question, "is one of my runs driving the stage?".
  While any workflow answers yes, the stage clock answers with the last
  position it was sent to instead of reading the instrument, and a stale
  half-written store is not swept away.
- **let_go**: what to do before another session opens or the window closes:
  stop what the workflow runs on its own, between two fields, and wait until
  it has (``wait_s`` is how long it may take). Called without holding the
  instrument's turn, because a run needs that turn to finish its field.
- **forget**: what to forget when a fresh session opens: the records of the
  last session's runs.
- **raw_kinds**: the kinds of acquisition whose ``view`` folder holds files
  the page fetches as they are (a focus stack's slice copies), and never as
  copies drawn with a display.
- **picture_endings**: pictures the workflow draws on request, by the end
  of their name: ``{".mask.png": draw}``, where ``draw(kind, label)``
  answers the file to send, or None for 404.

Plugging in again under the same name replaces what that name plugged in
before, which is what a test that builds the bridge twice needs.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

#: Everything plugged in, by the name it was plugged in under.
plugged: dict[str, dict] = {}


def plug(
    name: str,
    *,
    holds_the_stage: Callable[[], bool] | None = None,
    let_go: Callable[[float | None], None] | None = None,
    forget: Callable[[], None] | None = None,
    raw_kinds: tuple[str, ...] | frozenset[str] = (),
    picture_endings: dict[str, Callable[[str, str], Path | None]] | None = None,
) -> None:
    """Plug a workflow's half into the bridge under ``name``. See the module's docstring."""
    plugged[name] = {
        "holds_the_stage": holds_the_stage,
        "let_go": let_go,
        "forget": forget,
        "raw_kinds": frozenset(raw_kinds),
        "picture_endings": dict(picture_endings or {}),
    }


def each(what: str) -> list:
    """Everything plugged in under the key ``what``, leaving out what was not given."""
    return [one[what] for one in plugged.values() if one[what]]


def a_run_has_the_stage() -> bool:
    """Whether any workflow says one of its runs is driving the stage."""
    return any(question() for question in each("holds_the_stage"))


def let_go(wait_s: float | None = None) -> None:
    """Ask every workflow to stop what it runs on its own, and wait for each."""
    for stop in each("let_go"):
        stop(wait_s)


def forget() -> None:
    """Ask every workflow to forget the last session's runs."""
    for forgetting in each("forget"):
        forgetting()


def is_raw(kind: str) -> bool:
    """Whether this kind's view folder is served as it is, never drawn with a display."""
    return any(kind in kinds for kinds in each("raw_kinds"))


def drawing_for(name: str) -> tuple[str, Callable[[str, str], Path | None]] | None:
    """The ending of ``name`` some workflow draws on request, and how, or None."""
    for endings in each("picture_endings"):
        for ending, draw in endings.items():
            if name.endswith(ending):
                return ending, draw
    return None
