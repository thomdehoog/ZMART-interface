"""Handing a captured stack to ZMART-analysis, and reading its answer back.

:func:`~zmart_interface.parts.microscope.focus_run.measure_one_stack` files the
stack the page captured; this is how what it captured becomes a height. The two
are separate
because the loop is standard library plus ``zmart_controller`` on purpose --
that is what lets the operator page's bridge run on a microscope PC with
nothing installed on it -- while scoring pixels needs numpy, scipy, and an
environment to run them in.

There are two ways to reach the same step, and which one a caller wants depends
on what it can afford:

* :func:`in_process` imports the step and runs it here. A caller that already
  has numpy and scipy loaded pays one import rather than a subprocess.
* :func:`through` sends it to the warm analysis, which keeps a worker alive
  per environment with its modules already imported. That is the one the
  operator page wants: a focus map is one job per point, and paying a conda
  spawn per point would make the map slower than the stage.

Either way the answer is the same shape, because it is the same step.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

#: Which sharpness metric's peak is reported as the height. Both are always
#: scored -- the page charts one against the other -- so this only chooses
#: which one answers.
DEFAULT_METRIC = "brenner"

def what_was_captured(record: dict) -> dict:
    """The step's input for one acquire record: the planes, and their heights.

    Both are read straight off the record. A driver writes one 2-D plane per
    file and says where on the sample each was taken, which is the only place
    that knows: a saved file carries the size of a pixel and nothing about
    where it came from, and the stage stands at the middle of a stack while
    its planes are spread either side of it.

    Nothing is assembled and nothing is copied: the planes are read where the
    acquisition left them.
    """
    if record.get("zarr"):
        # Canonical TCZYX stores pack T/C from zero and Z in physical order.
        # The analysis reader obtains plane heights from that same store.
        return {"image_path": record["zarr"]}
    if record.get("synthetic_pixels") or record.get("zarr_error"):
        raise RuntimeError("Focus requires its canonical position; refusing different vendor pixels")
    every = record.get("planes") or []
    if not every:
        raise RuntimeError("the capture reported no planes, so there is no stack to score")
    # One channel's planes are the stack. A focus job that captures several
    # channels repeats every height once per channel, and scoring the
    # interleaved list refines a peak on a curve nobody measured.
    first = min(int(plane.get("c", 0)) for plane in every)
    planes = sorted(
        (plane for plane in every if int(plane.get("c", 0)) == first),
        key=lambda plane: plane.get("z", 0),
    )
    heights = [plane.get("z_um") for plane in planes]
    if any(height is None for height in heights):
        raise RuntimeError(
            "the capture did not say what height each plane was taken at, so "
            "the sharp one cannot be named in micrometres"
        )
    return {
        "image_paths": [plane["path"] for plane in planes],
        "z_um": [float(height) for height in heights],
    }


def as_a_measurement(scored: dict, *, metric: str = DEFAULT_METRIC) -> dict:
    """The step's answer, in the terms a focus map is written in.

    ``traces`` carries every metric's curve, not just the chosen one's, because
    a height alone cannot be argued with: the operator sees where each metric
    would have landed, and can say the routine picked the wrong peak.
    """
    heights = scored.get("z_um") or []
    return {
        "z_um": scored.get("peak_z_um"),
        "metric": metric,
        "traces": {
            name: {
                "samples": [
                    {"z": z, "s": s} for z, s in zip(heights, curve.get("scores") or [], strict=False)
                ],
                "peak_z_um": curve.get("peak_z_um"),
            }
            for name, curve in (scored.get("metrics") or {}).items()
        },
    }


def in_process(*, metric: str = DEFAULT_METRIC, **params: Any) -> Callable[[dict], dict]:
    """Score each stack here, in this process. For callers that already have numpy."""

    def score(record: dict) -> dict:
        run = _the_step()
        scored = run(
            {"input": what_was_captured(record), "metadata": {"verbose": 0}},
            {},
            metric=metric,
            **params,
        )["score_focus"]
        return as_a_measurement(scored, metric=metric)

    return score


#: The ZMART-analysis workflow that scores a stack.
PIPELINE = "focus"


def through(analysis: Any, *, metric: str = DEFAULT_METRIC) -> Callable[[dict], dict]:
    """Score each stack through *analysis*, whose workers are already running.

    The analysis is passed in and never built here, so its lifetime is the
    caller's: held for as long as the page is connected, not one per focus map
    and certainly not one per point. See
    :mod:`zmart_interface.parts.analysis.warm`.
    """

    def score(record: dict) -> dict:
        result = analysis.run(PIPELINE, what_was_captured(record))
        return as_a_measurement(result["score_focus"], metric=metric)

    return score


def _the_step() -> Callable:
    """``score_focus.run``, loaded from the ZMART-analysis workflows.

    Loaded when first asked for rather than at import, so that a caller who
    only wants :func:`through` -- the bridge -- never pays for scipy here.
    """
    from zmart_interface.parts.analysis.workflows import step_module  # noqa: PLC0415

    return step_module("focus", "score_focus").run
