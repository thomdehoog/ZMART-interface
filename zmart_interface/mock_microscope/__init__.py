"""The interface's test microscope: a pretend instrument, plugged in like any driver.

The mock is a complete ZMART driver that needs no hardware. Its functions,
one per command (``connect``, ``get_xyz``, ``acquire``, ...), are in
``zmart_controller_plugin.py`` with its ``NAME``, ``interface-mock``, and are
listed here too, so the package itself can be plugged in like any driver::

    from zmart_controller import ZmartController
    from zmart_interface import mock_microscope

    mic = ZmartController(mock_microscope, {"output_root": "my_images"})

or installed once on a computer with ``zmart_controller.register_driver``
(pointed at this folder, whose ``zmart_driver.json`` names it) and connected
to as ``"interface-mock"``.

Each function answers in the controller's two-part shape,
``{"success": True, "content": ...}``. The mock never needs to decline
softly: a request that is itself wrong -- a move outside the stage's travel,
an unknown motor or job -- raises ``ValueError`` before anything moves, and
anything else that goes wrong is raised as well. The controller turns such a
raise into the declined answer every caller reads, ``success`` False with the
reason as the content. The mock writes real image files, so the whole
interface -- the bridge, the page, the analysis and the viewer -- can be run
and tested on a desk.

``driver.py`` is the pretend instrument itself, ``window.py`` its own small
window, where a job is chosen the way an operator chooses one in the vendor's
software.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

from zmart_interface.mock_microscope.driver import open_the_window

# The functions the controller calls, one per command, are in
# ``zmart_controller_plugin.py``; listed here, they make this package a driver.
from zmart_interface.mock_microscope.zmart_controller_plugin import (
    CONNECTION,
    NAME,
    acquire,
    connect,
    disconnect,
    get_acquisition_settings,
    get_actuators,
    get_info,
    get_procedures,
    get_state,
    get_xyz,
    run_procedure,
    set_state,
    set_xyz,
)

__all__ = [
    "CONNECTION",
    "NAME",
    "acquire",
    "connect",
    "disconnect",
    "get_acquisition_settings",
    "get_actuators",
    "get_info",
    "get_procedures",
    "get_state",
    "get_xyz",
    "open_the_window",
    "run_procedure",
    "set_state",
    "set_xyz",
]

