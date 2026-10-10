"""Opening and closing the session: which microscopes are offered, and connecting to one.

The Connect step lists what this computer can drive (``/api/instruments``):
the interface's own mock microscope first, then every driver the controller's
registry knows. Connecting opens a ``ZmartController`` of the bridge's own
for the chosen one, makes the run folder every capture goes under, and
starts the picture server beside it. Disconnecting closes all of that.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import json
import sys

from zmart_controller import ZmartController
from zmart_controller.registry import find_driver, get_instruments

from zmart_interface import mock_microscope
from zmart_interface.parts.analysis import warm
from zmart_interface.parts.microscope.instrument import Instrument
from zmart_interface.parts.storage import viewer_service
from zmart_interface.parts.storage.output import checked_name, prepare_experiment

from . import hooks, state

#: The name the interface's own mock microscope is offered under, from its
#: plug-in. It is always offered, registered or not, and the bridge plugs the
#: package in directly.
INTERFACE_MOCK = mock_microscope.NAME


def instruments() -> list[str]:
    """The microscopes the Connect step offers, by name, in the order it shows them.

    The interface's own mock first, so a page opened by accident drives
    nothing real, then every driver installed on this computer, as the
    controller lists them.
    """
    return [INTERFACE_MOCK, *(name for name in get_instruments() if name != INTERFACE_MOCK)]


def saved_connection(name: str) -> dict:
    """The connection a listed microscope is plugged in with, before anything is added to it.

    For an installed driver, the connection its ``zmart_driver.json`` gives.
    Finding it imports the driver, which is why a name that is not listed is
    refused first: the page can only ever name a microscope this computer
    offers.
    """
    if name == INTERFACE_MOCK:
        return dict(mock_microscope.CONNECTION)
    if name not in instruments():
        raise ValueError(f"no microscope is listed as {name!r}; listed: {instruments()}")
    return find_driver(name)[1]


#: What a run is called on disk when the page names nothing: ``run_<hash>``.
#: A workflow names its own (Target acquisition's runs are
#: ``target-acquisition_<hash>``), so that its runs are told apart from other
#: workflows' by name and from each other by their hash.
A_RUN = "run"


def connect(asked: dict) -> dict:
    """Open the session for one of the listed microscopes and answer with the driver's account.

    ``asked["instrument"]`` is a name from :func:`instruments`, and
    ``asked["password"]``, when given, is what the operator typed; it is
    handed to the driver with the connection that was saved for it.
    ``asked["experiment"]`` is what the workflow calls its runs: the run
    folder is ``<experiment>_<hash>``. It is checked to be a plain folder
    name before anything is opened.
    """
    name = asked.get("instrument")
    if not isinstance(name, str):
        raise ValueError("connect needs the name of one of the microscopes listed by /api/instruments")
    experiment = checked_name(asked.get("experiment") or A_RUN, field="experiment")
    connection = saved_connection(name)
    if asked.get("password"):
        connection["password"] = asked["password"]
    if state.output_root is not None:
        connection["output_root"] = state.output_root
    # The session before this one is closed first. A page that is reloaded
    # connects again, and the old session was left open behind the new one:
    # the microscope software still had a client, and a scan still running
    # on it kept moving the stage. The scan itself was asked to stop by
    # :func:`let_the_last_session_go` before the instrument's turn was taken.
    close_the_last_session()
    # A controller of the bridge's own, not the module-level ``mic`` that
    # scripts share: the bridge opens and closes it, and nothing else may.
    driver = mock_microscope if name == INTERFACE_MOCK else name
    session = Instrument(ZmartController(driver, connection))
    if driver is mock_microscope:
        mock_microscope.open_the_window(connection)
    try:
        info = session.get_info()
        standing = session.get_xyz()
        area = the_viewers_area(standing)
        # One synthetic specimen per session, anchored in the same specimen
        # frame as the captured planes. Never recenter it for a new job,
        # tile or stack.
        provider = None
        if state.simulator_pixels_enabled:
            from zmart_interface.parts.microscope.simulator_pixels import KidneyPixels

            provider = KidneyPixels(focus_z_um=float(standing["z"]["position"]))
            provider.recipe["focus_reference"] = "session-connect"
        if not info.get("output_root"):
            raise RuntimeError(
                f"the microscope {name!r} does not say where its pictures are to be saved "
                "(its get_info gives no 'output_root'); start the interface with --output-root "
                "to choose a folder"
            )
        run = prepare_experiment(info["output_root"], experiment)
        if provider is not None:
            (run / "synthetic-specimen.json").write_text(
                json.dumps(provider.recipe, indent=2), encoding="utf-8")
    except Exception:
        # A microscope that cannot describe itself, say where its pictures
        # can show, or be given a folder to save into is not a session to
        # keep. Nothing of it was handed to the rest of the bridge yet, so
        # closing it here leaves no half-open session behind.
        session.disconnect()
        raise
    state.session = session
    state.context = {**session.context, "name": name}
    state.pixel_provider = provider
    state.run = run
    # A fresh session has scanned nothing. The bridge outlives the page, and
    # records carried over from the last session rebuilt its scan's pictures
    # into this run's view -- a just-connected canvas showed a scan nobody
    # had taken.
    state.records.clear()
    state.view_built.clear()
    state.displayed_pictures.clear()
    # And every workflow forgets how far its own runs had got.
    hooks.forget()
    # The picture server, beside the run: the viewer links each acquisition's
    # positions into one live picture and serves it to the page's own engine.
    # An optional guest -- a machine without it still scans, and still draws
    # the JPEG copies -- so a viewer that cannot start is a sentence on
    # /api/viewer, never a failed connect.
    viewer_service.stop()
    # Baked, always: the zoomed-out picture composed on demand from every
    # position measured seconds a chunk against milliseconds baked, and the
    # first screen of a scan is zoomed out.
    viewer_service.start(state.run, bake=True, canvas=area)
    return {"context": state.context, "info": info, "run": str(state.run)}


def the_viewers_area(reading: dict) -> dict[str, list[float]]:
    """The area the viewer lays pictures out on: get_xyz's ``canvas``, axis by axis.

    ``canvas`` is everywhere a picture can show along an axis -- the stage's
    travel and half a field (or half a stack) beyond it -- in the
    micrometres get_xyz counts in. The viewer refuses, whole, a picture that
    falls outside its area, so the area is laid out before the first picture
    from what the driver says, never guessed. A driver that does not say is
    refused at connect, in words the operator can act on.
    """
    area = {}
    for axis in ("x", "y", "z"):
        canvas = (reading.get(axis) or {}).get("canvas")
        if not (isinstance(canvas, (list, tuple)) and len(canvas) == 2):
            raise RuntimeError(
                f"the microscope's driver does not say where its pictures can show along {axis} "
                "(get_xyz gives no 'canvas'), so the area to show them on cannot be laid out; "
                "the driver needs updating to the controller's current contract"
            )
        area[f"{axis}_um"] = [float(canvas[0]), float(canvas[1])]
    return area


def let_the_last_session_go(wait_s: float | None = None) -> None:
    """Stop what the workflows run on their own before another session is opened.

    A workflow's runs (an overview scan, say) run in the bridge's own threads
    and outlive the page that started them. Each workflow is asked to stop
    them between two fields, as the operator's Interrupt does, and to wait
    until it has (see ``hooks.py``). It must be called without holding the
    instrument's turn, because a run needs that turn to finish its field.
    """
    hooks.let_go(wait_s)


def close_the_last_session() -> None:
    """Close the session that is open, if any, even when the microscope no longer answers.

    A microscope that has gone away cannot be closed politely, and that must
    not stop the operator from opening a new session, so a failure here is
    reported in the terminal and otherwise ignored.
    """
    if state.session is None:
        return
    try:
        state.session.disconnect()
    except Exception as why:  # noqa: BLE001 -- the old session is being let go either way
        print(f"the last session could not be closed cleanly: {why}", file=sys.stderr, flush=True)
    state.session = None
    state.run = None


def disconnect() -> dict:
    if state.session is not None:
        state.session.disconnect()
        state.session = None
    state.run = None
    state.pixel_provider = None
    # The context is the session's: a name left over from the last one
    # made the next session's readings pretend it was the mock.
    state.context = {}
    # The workers outlive a focus map on purpose, but not the session: a
    # disconnected page is not about to measure anything.
    warm.close()
    # The picture server belongs to the session's run, and goes with it.
    viewer_service.stop()
    return {"closed": True}
