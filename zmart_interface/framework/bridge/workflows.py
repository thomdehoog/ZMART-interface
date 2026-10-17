"""Each workflow's Python half, wired into the bridge at start-up.

A workflow dropped into ``zmart_interface/workflows/`` may have a Python half:
a package ``<folder>/bridge`` that defines ``routes(register)``.
``register(method, path, handler)`` adds one route under ``/api/<folder>/``:
``register("GET", "hello", say_hello)`` in ``workflows/three_steps/bridge``
answers ``GET /api/three_steps/hello``. A handler is written the way the
bridge's own are: it takes ``(asked, query)`` -- the request's JSON body as a
dictionary, and the raw query string -- and answers a dictionary, or raises
an exception whose sentence the page shows. A half that fails to import is a
fault in the interface itself, so the bridge does not start.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import importlib
from pathlib import Path

#: Where the workflows live.
WORKFLOWS = Path(__file__).resolve().parents[2] / "workflows"


def halves() -> list[str]:
    """The folders of the workflows that have a Python half, in order."""
    return sorted(
        folder.name for folder in WORKFLOWS.iterdir()
        if (folder / "bridge" / "__init__.py").is_file()
    )


def routes_under(folder: str, add_route):
    """The ``register`` a half is handed: ``add_route`` with ``/api/<folder>/`` in front."""

    def register(method, path, handler):
        add_route(method.upper(), f"/api/{folder}/{str(path).lstrip('/')}", handler)

    return register


def load_halves(add_route) -> None:
    """Import every workflow's Python half and register its routes. Called once when the bridge starts."""
    for folder in halves():
        module = importlib.import_module(f"zmart_interface.workflows.{folder}.bridge")
        module.routes(routes_under(folder, add_route))
