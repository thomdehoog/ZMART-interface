"""The interface's bridge offers its own mock first; the general bridge knows no instrument.

Step 5 of ``docs/plan-the-bridge-knows-no-workflow.md``. The bridge's general
part used to import the mock microscope, put it first in the list, open its
window, and carry the LAS X simulator's ``--simulator-pixels`` switch. Now
whoever starts the bridge says what it offers: ``serving.py`` starts it for
the interface, with the mock first and the simulator's stand-in pixels when
asked, and the mock opens its own window when its connection says so.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import pytest

from zmart_interface import mock_microscope, serving
from zmart_interface.framework.bridge import connecting, server, state
from zmart_interface.mock_microscope import driver


def test_the_interfaces_bridge_offers_its_mock_first(monkeypatch):
    monkeypatch.setattr(connecting, "get_instruments", lambda: ["stellaris", mock_microscope.NAME])
    bridge = serving.serve(0)
    try:
        assert connecting.instruments() == [mock_microscope.NAME, "stellaris"]
    finally:
        bridge.shutdown()
        bridge.server_close()


def test_the_general_bridge_offers_only_what_it_is_handed(monkeypatch):
    monkeypatch.setattr(connecting, "get_instruments", lambda: ["stellaris"])
    bridge = server.a_bridge_on(0)
    try:
        assert connecting.instruments() == ["stellaris"]
    finally:
        bridge.server_close()


def test_the_mock_is_offered_with_its_window(monkeypatch):
    name, (plugged, connection) = next(iter(serving.offered().items()))
    assert name == mock_microscope.NAME and plugged is mock_microscope
    assert connection["open_window"] is True


@pytest.mark.parametrize("asked", [True, False])
def test_the_mock_opens_its_own_window_only_when_its_connection_asks(monkeypatch, asked):
    opened = []
    monkeypatch.setattr(driver, "open_the_window", lambda connection: opened.append(connection))
    handle = driver.connect({**mock_microscope.CONNECTION, "open_window": asked})
    driver.disconnect(handle)
    assert len(opened) == (1 if asked else 0)


def test_stand_in_pixels_are_made_only_when_asked_for():
    assert serving.pixels_for(simulator_pixels=False) is None
    make = serving.pixels_for(simulator_pixels=True)
    provider = make(420.0)
    assert provider.focus_z_um == 420.0
    assert provider.recipe["focus_reference"] == "session-connect"


def test_the_switch_belongs_to_the_interface_not_the_general_bridge():
    import argparse

    general = argparse.ArgumentParser()
    server.add_arguments(general)
    assert "--simulator-pixels" not in general.format_help()
    ours = argparse.ArgumentParser()
    serving.add_arguments(ours)
    assert "--simulator-pixels" in ours.format_help()
    assert not hasattr(state, "simulator_pixels_enabled")
