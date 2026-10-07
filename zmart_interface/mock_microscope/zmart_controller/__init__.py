"""The mock microscope's plug-in for the ZMART Controller.

This folder is what the controller looks for: ``zmart.json`` beside this file
names the instrument, and the functions below are found by name. Each one
calls the mock's own function in ``driver.py`` and answers in the
controller's two-part shape::

    {"success": True,  "content": ...}   done
    {"success": False, "content": {"reason": ...}}   declined, nothing changed

A request the mock declines safely -- a move outside the stage's travel -- is
answered with ``success: False``. Anything else that goes wrong is raised, as
the controller's contract asks.

Plug it in like any driver; the interface's bridge does it for you::

    import zmart_controller
    from zmart_interface import mock_microscope

    zmart_controller.register_driver(mock_microscope.FOLDER, remember=False)

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import functools

from zmart_interface.mock_microscope import driver as _driver


def _answered(function):
    """Wrap one of the mock's functions in the controller's two-part reply."""

    @functools.wraps(function)
    def answer(*args, **kwargs):
        try:
            content = function(*args, **kwargs)
        except _driver.Refused as why:
            return {"success": False, "content": {"reason": str(why)}}
        return {"success": True, "content": content}

    return answer


connect = _driver.connect
disconnect = _driver.disconnect
get_info = _answered(_driver.get_info)
get_actuators = _answered(_driver.get_actuators)
get_xyz = _answered(_driver.get_xyz)
set_xyz = _answered(_driver.set_xyz)
get_state = _answered(_driver.get_state)
set_state = _answered(_driver.set_state)
get_acquisition_settings = _answered(_driver.get_acquisition_settings)
acquire = _answered(_driver.acquire)
get_procedures = _answered(_driver.get_procedures)
run_procedure = _answered(_driver.run_procedure)
