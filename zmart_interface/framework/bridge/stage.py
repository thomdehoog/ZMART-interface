"""Where the stage is, and driving it on the operator's own say-so.

The page asks every few seconds where the stage stands, and drives it when
the operator double-clicks a place on the picture. Both go through here,
and both answer in ``get_xyz``'s shape, one entry per axis with its
``position``, so the mark on the canvas is put in the same place through
the same field names whichever of the two it came from.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

from . import state


def where_the_stage_is() -> dict:
    """``get_xyz``, unless a run holds the instrument's turn: then the last
    reading, marked ``busy``.

    The page asks every few seconds and gives up client-side after a moment,
    but the request it abandoned stayed queued here behind the site being
    captured, and every queued one then read the stage -- from an instrument
    that answers nothing right after an export -- before the run could take
    its next turn. The panel froze and the run crawled, over a mark that only
    needs to know where the stage was last.
    """
    if not a_run_has_the_stage() and state.the_instruments_turn.acquire(blocking=False):
        try:
            state.last_xyz = state.require_session().get_xyz()
            return state.last_xyz
        finally:
            state.the_instruments_turn.release()
    if state.last_xyz is None:
        raise RuntimeError("the instrument is busy and has not yet said where the stage is")
    return {**state.last_xyz, "busy": True}


def a_run_has_the_stage() -> bool:
    """Whether a focus map, a scan, discovery or a target run is driving the
    stage.

    For as long as one is, its own record of where it sent the stage is the
    answer, even between two sites when the instrument's turn is free: a
    position read right after a move can still report the site before, and
    the mark jumped back and forth on that stale answer.
    """
    return any(run.get("running") for run in (state.focus, state.scan, state.targets, state.acquired))


def the_stage_was_sent_to(x: float, y: float, z: float) -> None:
    """A run's own record of where it drove the stage, for the clock above."""
    state.last_xyz = {
        "x": {"position": float(x)}, "y": {"position": float(y)}, "z": {"position": float(z)},
    }


def drive_to(asked: dict) -> dict:
    """Drive the stage where the operator asked, and answer with where it is.

    ``set_xyz`` is synchronous and confirmed — the driver moves, checks, and
    raises if it could not — so by the time this returns the stage is standing
    there. That is what lets the page move the mark the moment the answer lands
    instead of waiting for the watch's next turn of the clock.

    Its answer is what says where, rather than a fresh ``get_xyz``. Reading the
    stage again would be a second trip to the instrument for something it has
    just told us, and on this microscope a position read is the call that hangs
    — it is why the driver has log-reading alternatives at all. A driver that
    reports no position is asked, because some may not.

    Reshaped into the one form the page knows, which is ``get_xyz``'s: the
    drive and the watch put the mark in the same place through the same field
    names, and neither has to know which of the two it came from.

    ``z`` is optional and left where it stands when it is not given: an
    operator driving to a place on the plate is asking to move across it, not
    to change how far the objective is from it.
    """
    session = state.require_session()
    standing = session.get_xyz()
    here = lambda axis: float(standing.get(axis, {}).get("position", 0.0))  # noqa: E731
    went = session.set_xyz(
        float(asked.get("x", here("x"))),
        float(asked.get("y", here("y"))),
        float(asked["z"]) if asked.get("z") is not None else here("z"),
    )
    # The controller's set_xyz answers exactly like get_xyz, read back after
    # the stage has arrived, so that answer is the reading. A driver that
    # answers something else is asked once more.
    if isinstance(went, dict) and all(axis in went for axis in ("x", "y", "z")):
        state.last_xyz = went
    else:
        state.last_xyz = session.get_xyz()
    return state.last_xyz
