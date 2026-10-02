"""The interface's test microscope: a pretend instrument, plugged in like any driver.

The mock is a complete ZMART driver that needs no hardware. It plugs into
the ZMART Controller by its folder (``zmart_controller/zmart.json`` and the
functions beside it), answers every command in the controller's
``{"success", "report"}`` shape, and writes real image files, so the whole
interface -- the bridge, the page, the analysis and the viewer -- can be run
and tested on a desk.

``driver.py`` is the pretend instrument itself, ``window.py`` its own small
window, where a job is chosen the way an operator chooses one in the vendor's
software.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
from pathlib import Path

# Under another name: importing the plug-in folder below, which is also called
# ``zmart_controller``, puts that name on this package and would hide the controller.
import zmart_controller as _controller

#: The folder the ZMART Controller is pointed at to plug the mock in.
FOLDER = Path(__file__).resolve().parent

#: How the mock's entry in the controller's list names its maker.
VENDOR = "mock"


def register() -> list[dict]:
    """Plug the mock into the controller for this session, and list what it adds.

    Never remembered on the computer: the mock is offered by whoever wants
    it -- the interface's bridge, a test -- rather than standing in every
    later session's list of real instruments.
    """
    return _controller.register_driver(FOLDER, remember=False)


def open_the_window(connection: dict) -> None:
    """Open the mock's own window beside a session, unless one is open already.

    On a real microscope the vendor's software is simply there; the mock has
    only its window, and an operator connecting to the mock wants it in front
    of them without remembering to start it. Its own process, so closing it
    never touches the session. A window that cannot be opened is a warning,
    never a failed connect.
    """
    from zmart_interface.mock_microscope import driver  # noqa: PLC0415

    state_file = driver.where_the_instrument_stands(connection)
    if driver.the_window_is_open(state_file):
        return
    try:
        subprocess.Popen(
            [sys.executable, "-m", "zmart_interface.mock_microscope.window"],
            env={**os.environ, driver.STATE_FILE_ENV: str(state_file)},
        )
    except OSError as why:
        logging.getLogger(__name__).warning("the mock instrument window could not be opened: %s", why)
