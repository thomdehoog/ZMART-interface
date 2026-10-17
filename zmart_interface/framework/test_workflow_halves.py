"""Each workflow's Python half is wired into the bridge at start-up, under its own folder.

A workflow dropped into ``zmart_interface/workflows/`` may have a Python half,
a package ``<folder>/bridge`` with ``routes(register)``. The bridge loads every
one when it starts, and each half's routes land under ``/api/<folder>/``. The
bridge has no routes of its own: what a workflow asks of a microscope is the
workflow's (target acquisition's are pinned in its ``bridge/test_the_routes.py``).

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import subprocess
import sys

from zmart_interface.framework.bridge import server, workflows


def test_the_bridge_registers_no_route_of_its_own():
    """Imported on its own, in a fresh process, before any half is loaded."""
    said = subprocess.run(
        [sys.executable, "-c", "from zmart_interface.framework.bridge import server; "
                               "print(len(server.ROUTES), len(server.PREFIX_ROUTES))"],
        capture_output=True, text=True, check=True,
    ).stdout.split()
    assert said == ["0", "0"]


def test_every_halfs_routes_land_under_its_folder(monkeypatch):
    monkeypatch.setattr(server, "ROUTES", {})
    monkeypatch.setattr(server, "PREFIX_ROUTES", {})
    loaded = workflows.load_halves(server.add_route)
    folders = {name for name, _ in loaded}
    for _, path in (*server.ROUTES, *server.PREFIX_ROUTES):
        assert path.split("/")[2] in folders, path


def test_the_halves_are_the_workflow_folders_with_a_bridge_package():
    assert workflows.halves() == ["target_acquisition"]
