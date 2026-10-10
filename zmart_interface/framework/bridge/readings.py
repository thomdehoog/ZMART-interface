"""Readouts, never procedures: the instrument's state shaped into what the page records.

A preset -- the acquisition settings and the focussing preset alike -- is
the instrument read as it stands, after its operator set it up in the
vendor's own software: a one-line summary, the detail rows behind it, the
frame size the plan is laid with, and the changeable half the step hands
back when it runs. Nothing here moves anything. Capturing once where the
stage stands, and applying settings, are the controller's own verbs
carried through unchanged.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import json

from . import state

#: What the operator is told to check when the microscope leaves a size out.
CHECK_THE_JOB = (
    "check that the job's image settings can be read in the microscope's own "
    "software, then read the settings again"
)


def flatten(prefix: str, mapping: dict, rows: list) -> None:
    for key, value in mapping.items():
        label = f"{prefix}{key}".replace("_", " ")
        if isinstance(value, dict) and "unit" not in value:
            flatten(f"{label} · ", value, rows)
        else:
            rows.append(
                [label, json.dumps(value, default=str) if isinstance(value, dict) else str(value)]
            )


def optics(observed: dict) -> str:
    """How the light path reads on one line: magnification, aperture, zoom.

    What an operator checks a configuration by: which lens, and how much light
    it collects. The scanner's zoom was here too and came off again — it is one
    more number on a line that is read at a glance, and the objective and the
    pixel size already say what the picture will be. A driver that does not
    report its optics gets nothing here
    and the caller falls back to naming the instrument, because a line of
    blanks says less than a serial number.
    """
    lens = observed.get("objective") or observed.get("active_objective") or {}
    said = []
    if lens.get("name"):
        # The Leica names its lens outright, and the name is what identifies
        # it on the shelf; magnification and aperture only qualify it.
        said.append(str(lens["name"]))
    elif lens.get("magnification"):
        said.append(f"{lens['magnification']:g}x")
    if lens.get("numerical_aperture"):
        na = f"{lens['numerical_aperture']:g} NA"
        if lens.get("immersion"):
            na = f"{na} {lens['immersion']}"
        said.append(na)
    return " · ".join(said)


def a_number(value) -> float | None:
    """A positive, finite number, or nothing. Booleans are not numbers here."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if value > 0 and value == value and value != float("inf") else None


def format_across(observed: dict) -> float | None:
    """How many pixels wide a frame is, however the driver says it.

    ``"2048 x 2048"`` is LAS X's own wording, straight out of the job's
    ``format``; a pair of numbers is what a driver reports when it has already
    parsed that. Only the first figure is read — a plan is laid in square
    frames, and a non-square one would need the whole page to grow a second
    dimension before it could be honoured rather than silently halved.
    """
    said = observed.get("format")
    if isinstance(said, str) and "x" in said.lower():
        first = said.lower().split("x")[0].strip()
        try:
            return a_number(float(first))
        except ValueError:
            return None
    if isinstance(said, dict):
        return a_number(said.get("x"))
    if isinstance(said, (list, tuple)) and said:
        return a_number(said[0])
    return a_number(observed.get("pixels_x"))


def frame_across(observed: dict, pixel_um: float) -> int:
    """How wide one frame is on the sample, in micrometres.

    Two ways of knowing, in the order they are worth believing.

    **What the instrument measured.** ``frame_size``, shaped like
    ``pixel_size``: LAS X reports ``imageSize`` and the driver parses it. That
    is the field of view itself, and nothing derived from it can be more true.

    **The format and the pixel size.** Failing a field of view, how many pixels
    across times how much sample each covers. This is why the format has to
    reach here at all: it changes — an operator switching a job from 512 to
    2048 changes the ground one frame covers by a factor of four, and a plan
    laid at the old frame would tile the sample with holes or overlaps nobody
    asked for.

    When the instrument says neither, the frame is not known, and this raises
    rather than assume one: a plan laid on an assumed frame has gaps or
    overlaps that nothing on the page would explain.
    """
    reported = observed.get("frame_size")
    if isinstance(reported, dict):
        said = a_number(reported.get("x"))
        if said is not None:
            return round(said)
    across = format_across(observed)
    if across is None:
        raise RuntimeError(
            "the microscope did not report how wide its image is (neither its field of view "
            f"nor how many pixels across), so a scan cannot be planned; {CHECK_THE_JOB}"
        )
    return round(across * pixel_um)


def pixel_size_um(observed: dict) -> float | None:
    """How much sample one pixel covers, in micrometres, or None when not reported.

    ``or {}``, not a default: the Leica reports ``pixel_size`` as None when
    the job's geometry fails to parse, and a default never fires on None.
    """
    return a_number((observed.get("pixel_size") or {}).get("x"))


def required_pixel_size_um(observed: dict) -> float:
    """The reported pixel size, or a refusal that says what to check.

    Never a guess. Every size on the page -- the frame a scan is planned
    with, the diameter objects are found at -- is counted in pixels times
    this, and a guessed one makes all of them wrong without a word.
    """
    measured = pixel_size_um(observed)
    if measured is None:
        raise RuntimeError(f"the microscope did not report its pixel size; {CHECK_THE_JOB}")
    return measured


def reading(kind: str) -> dict:
    """The instrument's state, now, as the reading the window records.

    ``kind`` is which slot is asking — ``acquisition`` or ``autofocus`` — and
    changes only the labelling: the readout underneath is the same
    ``get_state`` either way, because a preset is a readout and never a
    procedure. The instrument is read as it stands: its operator set it up
    in its own software before pressing Import -- LAS X on the Leica, the
    mock microscope's own window (``mock_microscope/window.py``) on the mock.
    """
    session = state.require_session()
    settings = session.get_state()
    observed = settings.get("observed", {})
    frame_um = frame_across(observed, required_pixel_size_um(observed))

    rows: list = []
    flatten("", settings.get("changeable", {}), rows)
    flatten("", observed, rows)

    summary = (optics(observed) or observed.get("serial")
               or observed.get("serial_number")
               or state.context.get("name", "instrument"))
    # The frame, not the pixel size: a collapsed configuration is read to
    # answer "how much ground does one press get me", and a pixel size answers
    # that only once multiplied by a format the line does not carry.
    summary = f"{summary} · {frame_um} × {frame_um} µm"
    reading = {
        "summary": summary, "detail": rows, "frameUm": frame_um,
        # The reapplicable half, kept with the reading: a recording is the
        # instrument's changeable state, and the step that recorded it hands
        # it back when it runs. Without this the recordings were readouts
        # that configured nothing.
        "changeable": settings.get("changeable", {}),
    }
    if kind == "autofocus":
        # The stand does not say which family its autofocus is; software is
        # the safe default and the Leica driver's state will name its own.
        # Said in ``kind`` and not in the summary: the row is for the numbers
        # an operator checks, and the family led it as a word nobody asked for.
        reading["kind"] = "software"
    return reading


def apply_state(asked: dict) -> dict:
    """Change settings on the instrument, and answer with what stuck.

    The page names only the settings it is changing; ``changeable`` is where
    the contract says they go, and the page has no business sending an
    ``observed`` half — that is the driver's report about itself, never an
    instruction. What comes back is the driver's own account of what it
    applied, which is not always what was asked: a value it will not take is
    the driver's to refuse.

    Which settings exist here is the driver's business, as it is for the menu.
    On the Leica it is the LAS X job; on another instrument it is whatever
    that instrument lets a client change.

    Nothing on the operator page calls this, and that is a decision rather
    than an omission: the page reads what it is told and leaves the
    choosing to the software that authors the recipes, where what each
    one carries can be seen. The verb is here because the seam mirrors
    the controller's surface, not this one page's needs.
    """
    return state.require_session().set_state({"changeable": dict(asked)})


def capture(asked: dict) -> dict:
    """Capture once where the stage is standing, and answer as the controller does.

    The answer is the controller's own, ``{"success": ..., "content": ...}``,
    passed on untouched: the content's ``files`` lists every file the capture
    saved and its ``planes`` say which channel, depth and stage position each
    picture is. What one capture wrote is known only to the capture, so it is
    answered whole rather than picked over, and a capture the microscope
    declined is an answer with ``success`` false, as it is to a script.

    ``acquisition_settings`` go through as they came from
    ``get_acquisition_settings``. Whatever is left out the driver fills from
    its own actives, which is why nothing here invents a default. ``folder``
    is the page's name for the acquisition this capture belongs to; it is
    offered to the driver as its ``folder`` setting when the driver has one
    (see :meth:`Instrument.acquire_answer`). The page files the capture under
    that name itself afterwards, through the route it sends the record to.
    """
    return state.require_session().acquire_answer(
        position_label=str(asked["position_label"]),
        acquisition_settings=asked.get("acquisition_settings"),
        folder=asked.get("folder"),
    )


def acquisition_settings() -> dict:
    """What the instrument offers for a capture, and what is chosen now.

    The driver's own menu, forwarded untouched: ``{name: {options, active}}``,
    where which settings exist at all is the driver's business. Nothing here
    renames or filters it, because the same shape goes back to ``acquire`` at
    capture time — a page that reworded it would have to word it back.
    """
    return state.require_session().get_acquisition_settings()
