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

from zmart_controller import ZmartController
from zmart_controller.registry import find_driver, get_instruments

from zmart_interface import mock_microscope
from zmart_interface.parts.analysis import warm
from zmart_interface.parts.microscope.instrument import Instrument
from zmart_interface.parts.storage import viewer_service
from zmart_interface.parts.storage.output import prepare_experiment

from . import state

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


#: What a run made through this page is called. One name for the workflow, so
#: two runs are told apart by their hash and not by what somebody typed.
EXPERIMENT = "target-acquisition"


def connect(asked: dict) -> dict:
    """Open the session for one of the listed microscopes and answer with the driver's account.

    ``asked["instrument"]`` is a name from :func:`instruments`, and
    ``asked["password"]``, when given, is what the operator typed; it is
    handed to the driver with the connection that was saved for it.
    """
    name = asked.get("instrument")
    if not isinstance(name, str):
        raise ValueError("connect needs the name of one of the microscopes listed by /api/instruments")
    connection = saved_connection(name)
    if asked.get("password"):
        connection["password"] = asked["password"]
    if state.output_root is not None:
        connection["output_root"] = state.output_root
    # A controller of the bridge's own, not the module-level ``mic`` that
    # scripts share: the bridge opens and closes it, and nothing else may.
    driver = mock_microscope if name == INTERFACE_MOCK else name
    state.session = Instrument(ZmartController(driver, connection))
    state.context = {**state.session.context, "name": name}
    if driver is mock_microscope:
        mock_microscope.open_the_window(connection)
    try:
        info = state.session.get_info()
        standing = state.session.get_xyz()
        area = the_viewers_area(standing)
    except Exception:
        # A microscope that cannot describe itself, or say where its
        # pictures can show, is not a session to keep.
        state.session.disconnect()
        state.session = None
        raise
    # One synthetic specimen per session, anchored in the same specimen frame
    # as the captured planes. Never recenter it for a new job, tile or stack.
    state.pixel_provider = None
    if state.simulator_pixels_enabled:
        from zmart_interface.parts.microscope.simulator_pixels import KidneyPixels

        try:
            state.pixel_provider = KidneyPixels(focus_z_um=float(standing["z"]["position"]))
            state.pixel_provider.recipe["focus_reference"] = "session-connect"
        except Exception:
            state.session.disconnect()
            state.session = None
            raise
    state.run = prepare_experiment(info["output_root"], EXPERIMENT)
    if state.pixel_provider is not None:
        (state.run / "synthetic-specimen.json").write_text(
            json.dumps(state.pixel_provider.recipe, indent=2), encoding="utf-8")
    # A fresh session has scanned nothing. The bridge outlives the page, and
    # records carried over from the last session rebuilt its scan's pictures
    # into this run's view -- a just-connected canvas showed a scan nobody
    # had taken.
    state.records.clear()
    state.view_built.clear()
    state.displayed_pictures.clear()
    state.scan.update(
        running=False, done=0, of=0, error=None, stopped=False,
        acquisition_type=None, records=[], planned=[],
    )
    state.focus.update(running=False, done=0, of=0, error=None, points=[])
    state.acquired.update(running=False, done=0, of=0, error=None, stopped=False, records=[])
    state.targets.update(
        running=False, done=0, of=0, error=None, stopped=False, fields=[],
        failed=[], doing=None, phase=None, objects=0,
    )
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
