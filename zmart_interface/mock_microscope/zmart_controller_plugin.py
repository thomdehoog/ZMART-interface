"""The mock microscope's plug-in for the ZMART Controller: the functions it calls.

The controller finds a driver's functions by name, one per command, and this
file holds them. Each calls the mock's own function in ``driver.py`` and
answers in the controller's two-part shape, ``{"success": True, "content": ...}``.
``NAME`` is what the mock is listed as, and ``CONNECTION`` what it is plugged
in with when nothing else is given.

Register it once on a computer, and it is listed by the controller like any
other driver::

    import zmart_controller
    zmart_controller.register_driver("path/to/zmart_interface/mock_microscope")

The interface's bridge does not need that: it always offers the mock, and
plugs this package in directly.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import functools

from zmart_interface.mock_microscope import driver as _driver

#: What the mock is listed as. Not "mock": that name is the controller's own
#: pretend microscope, a slide of beads, and an operator who chose the
#: interface's mock must get this one.
NAME = "interface-mock"

#: What the mock is plugged in with when nothing else is given. Images go to
#: ``mock-output`` in the working folder unless ``output_root`` says otherwise.
CONNECTION = {"client": "mock-client"}


def _answered(function):
    """Wrap one of the mock's functions in the controller's two-part reply."""

    @functools.wraps(function)
    def answer(*args, **kwargs):
        return {"success": True, "content": function(*args, **kwargs)}

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
