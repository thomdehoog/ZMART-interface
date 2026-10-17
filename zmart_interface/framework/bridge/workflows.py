"""Each workflow's Python half, found and wired into the bridge at start-up.

A workflow dropped into ``zmart_interface/workflows/`` may have a Python half:
a package ``<folder>/bridge``. What the bridge asks of it, and what it may use
of the bridge, is :mod:`zmart_interface.framework.bridge.api`. Its routes land
under ``/api/<folder>/``: ``register("GET", "hello", say_hello)`` in
``workflows/three_steps/bridge`` answers ``GET /api/three_steps/hello``. A half
that fails to import is a fault in the interface itself, so the bridge does
not start.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import importlib
from pathlib import Path

#: Where the workflows live.
WORKFLOWS = Path(__file__).resolve().parents[2] / "workflows"

#: The folder the package ``zmart_interface`` sits in, so a half's module name
#: follows from where its folder is.
WHERE_THE_PACKAGE_IS = Path(__file__).resolve().parents[3]


def halves(folder: Path = WORKFLOWS) -> list[str]:
    """The workflows in ``folder`` that have a Python half, in order."""
    return sorted(
        one.name for one in folder.iterdir()
        if (one / "bridge" / "__init__.py").is_file()
    )


def routes_under(folder: str, add_route):
    """The ``register`` a half is handed: ``add_route`` with ``/api/<folder>/`` in front."""

    def register(method, path, handler, prefix=False):
        add_route(method.upper(), f"/api/{folder}/{str(path).lstrip('/')}", handler, prefix=prefix)

    return register


def load_halves(add_route, folder: Path = WORKFLOWS) -> list[tuple[str, object]]:
    """Import every workflow's Python half in ``folder`` and register its routes.

    Answers the halves as ``(folder name, module)``, so whoever starts the
    bridge can hand each its options, start it and close it.
    """
    package = ".".join(folder.resolve().relative_to(WHERE_THE_PACKAGE_IS).parts)
    loaded = []
    for name in halves(folder):
        module = importlib.import_module(f"{package}.{name}.bridge")
        module.routes(routes_under(name, add_route))
        loaded.append((name, module))
    return loaded
