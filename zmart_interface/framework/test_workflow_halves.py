"""Each workflow's Python half is wired into the bridge at start-up, under its own folder.

A workflow dropped into ``zmart_interface/workflows/`` may have a Python half,
a package ``<folder>/bridge`` with ``routes(register)``. The bridge loads every
one when it starts, and each half's routes land under ``/api/<folder>/``; the
bridge's own routes are the general ones every workflow needs.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

from zmart_interface.framework.bridge import server, workflows


def test_the_bridges_own_routes_are_only_the_general_ones():
    """The general part answers what every workflow needs, and nothing of any one workflow."""
    general = {
        ("GET", "/api/setting"), ("GET", "/api/instruments"), ("GET", "/api/info"), ("GET", "/api/xyz"),
        ("GET", "/api/acquisition_settings"), ("GET", "/api/viewer"),
        ("POST", "/api/connect"), ("POST", "/api/disconnect"), ("POST", "/api/xyz"), ("POST", "/api/state"),
        ("POST", "/api/acquire"),
    }
    own = {route for route in server.ROUTES if route[1].split("/")[2] not in workflows.halves()}
    assert own == general


def test_every_route_target_acquisition_speaks_is_registered_under_its_folder(monkeypatch):
    """The 25 routes the page's Target acquisition asks for, all under ``/api/target_acquisition/``."""
    monkeypatch.setattr(server, "ROUTES", dict(server.ROUTES))
    workflows.load_halves(server.add_route)
    under = "/api/target_acquisition/"
    expected = {(method, under + path) for method, path in {
        ("GET", "scan"), ("GET", "focus/measure"), ("GET", "targets/discover"), ("GET", "plots/compute"),
        ("GET", "protocols"), ("GET", "plots/columns"), ("GET", "targets/acquire"),
        ("POST", "focus/begin"), ("POST", "focus/score"), ("POST", "focus/stop"), ("POST", "focus/end"),
        ("POST", "plots/compute"), ("POST", "plots/compute/stop"),
        ("POST", "protocol"), ("POST", "protocol/save"), ("POST", "protocols"),
        ("POST", "targets/acquire/begin"), ("POST", "targets/acquire/focus"),
        ("POST", "targets/acquire/landed"), ("POST", "targets/acquire/end"),
        ("POST", "targets/discover/stop"), ("POST", "scan"), ("POST", "scan/stop"),
        ("POST", "targets/discover"), ("POST", "targets/raise"),
    }}
    assert {route for route in server.ROUTES if route[1].startswith(under)} == expected


def test_the_halves_are_the_workflow_folders_with_a_bridge_package():
    assert workflows.halves() == ["target_acquisition"]
