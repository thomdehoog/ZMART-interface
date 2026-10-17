"""Target acquisition offers its own mock first, and its switches belong to it.

Without it, the list is the controller's. Target acquisition's Python half,
started with the bridge, puts its own mock first and the simulator's
stand-in pixels when asked, and the mock opens its own window when its
connection says so.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import argparse

import pytest

from zmart_interface.framework.bridge import server, workflows

from .. import mock_microscope
from ..mock_microscope import driver
from . import connecting, starting, state


def test_target_acquisition_offers_its_mock_first(monkeypatch):
    monkeypatch.setattr(connecting, "get_instruments", lambda: ["stellaris", mock_microscope.NAME])
    bridge = server.serve(0)
    try:
        assert connecting.instruments() == [mock_microscope.NAME, "stellaris"]
    finally:
        bridge.shutdown()
        bridge.server_close()


def test_without_its_own_mock_the_list_is_the_controllers(monkeypatch):
    monkeypatch.setattr(connecting, "get_instruments", lambda: ["stellaris"])
    monkeypatch.setattr(connecting, "offered", {})
    assert connecting.instruments() == ["stellaris"]


def test_the_mock_is_offered_with_its_window():
    name, (plugged, connection) = next(iter(starting.offered().items()))
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
    assert starting.pixels_for(simulator_pixels=False) is None
    make = starting.pixels_for(simulator_pixels=True)
    provider = make(420.0)
    assert provider.focus_z_um == 420.0
    assert provider.recipe["focus_reference"] == "session-connect"


def test_the_switch_belongs_to_target_acquisition_and_names_the_window():
    general = argparse.ArgumentParser()
    server.add_arguments(general)
    assert "--simulator-pixels" not in general.format_help()
    ours = argparse.ArgumentParser()
    halves = workflows.load_halves(server.add_route)
    server.add_arguments(ours, halves)
    assert "--simulator-pixels" in ours.format_help()
    bridge = server.a_bridge_on(0, ours.parse_args(["--simulator-pixels"]), halves=halves)
    try:
        assert bridge.title == "ZMART — LAS X SIMULATOR / SYNTHETIC PIXELS"
        assert state.pixels_for is not None
    finally:
        bridge.server_close()
