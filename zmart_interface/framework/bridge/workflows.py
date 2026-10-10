"""The bridge's side of installed workflows: listing them for the page, and each one's Python half.

The computer's workflow library (:mod:`zmart_interface.framework.workflow_library`)
holds the packages somebody installed. The page asks ``GET /api/workflows``
for the list as it opens and loads each package's bundle; this module
answers that list, and at start-up imports the Python half a package may
name, so its routes are there before the page asks for them.

A workflow's Python half is a module importable from the bridge's
environment, named in the package's ``workflow.json`` as ``"python"``. It
defines ``routes(register)``, and ``register(method, path, handler)`` adds
one route under ``/api/<folder>/``: ``register("GET", "hello", say_hello)``
answers ``GET /api/three_steps/hello``. A handler is written the way the
bridge's own are: it takes ``(asked, query)`` -- the request's JSON body as a
dictionary, and the raw query string -- and answers a dictionary, or raises
an exception whose sentence the page shows. A module that fails to import
leaves its workflow listed with an ``error`` sentence, and the page refuses
to load it rather than running a workflow whose routes are missing.

The workflows that ship inside the interface (``zmart_interface/workflows/``)
have a Python half the same way: a package ``<folder>/bridge`` with the same
``routes(register)``, its routes under the same ``/api/<folder>/``. They are
loaded first, and their folder names are reserved, so an installed package
cannot take them over.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import importlib
from pathlib import Path

from .. import workflow_library

#: Where the workflows that ship inside the interface live.
BUILT_IN = Path(__file__).resolve().parents[2] / "workflows"


def built_in_halves() -> list[str]:
    """The folders of the built-in workflows that have a Python half, in order."""
    return sorted(
        folder.name for folder in BUILT_IN.iterdir()
        if (folder / "bridge" / "__init__.py").is_file()
    )


def routes_under(folder: str, add_route):
    """The ``register`` a half is handed: ``add_route`` with ``/api/<folder>/`` in front."""

    def register(method, path, handler):
        add_route(method.upper(), f"/api/{folder}/{str(path).lstrip('/')}", handler)

    return register


def load_built_in_halves(add_route) -> None:
    """Import every built-in workflow's Python half and register its routes.

    A built-in half that fails to import is a fault in the interface itself,
    not in something somebody installed, so it is raised rather than listed.
    """
    for folder in built_in_halves():
        module = importlib.import_module(f"zmart_interface.workflows.{folder}.bridge")
        module.routes(routes_under(folder, add_route))

#: The Python halves that could not be imported or wired when the bridge
#: started, by folder: the sentence each failed with, carried in the listing.
python_errors: dict[str, str] = {}

#: The packages that were installed when the bridge started, by folder. A
#: Python half is imported only then, so a package installed later that has
#: one is not finished until the interface is started again.
installed_at_start: set[str] = set()


def load_python_halves(add_route, reserved=frozenset()) -> dict[str, str]:
    """Import every workflow's Python half, built in and installed, and register its routes.

    ``add_route(method, path, handler)`` is the bridge's own way of adding a
    route; each half's routes land under ``/api/<folder>/``. The built-in
    halves come first (:func:`load_built_in_halves`). ``reserved`` are the
    first parts of the bridge's own routes (``instruments`` for
    ``/api/instruments``); they and the built-in workflows' folders are names
    an installed package may not use, because its routes would replace
    theirs, so its half is not loaded and the listing says why. Called once
    when the bridge starts. Answers the installed halves' errors, by folder,
    and keeps them for the listing; a half that imports cleanly leaves no
    entry.
    """
    python_errors.clear()
    installed_at_start.clear()
    load_built_in_halves(add_route)
    taken = frozenset(reserved) | frozenset(built_in_halves())
    for package in workflow_library.installed():
        folder = package["folder"]
        installed_at_start.add(folder)
        module_name = package.get("python")
        if not module_name or package.get("error"):
            continue
        if folder in taken:
            python_errors[folder] = (
                f"its folder name {folder!r} is a name the interface uses for its own routes; "
                "give the package another folder name and install it again"
            )
            continue
        try:
            module = importlib.import_module(module_name)
            routes = getattr(module, "routes", None)
            if routes is None:
                raise AttributeError(f"{module_name} has no routes(register) function")
            routes(routes_under(folder, add_route))
        except Exception as why:  # noqa: BLE001 -- said in the listing, whatever it was
            python_errors[folder] = (
                f"its Python half could not be imported: {type(why).__name__}: {why}"
            )
    return dict(python_errors)


def listing() -> dict:
    """What the page asks as it opens: every installed package, as ``{"workflows": [...]}``.

    Read from the library every time, so a package installed while the
    bridge runs appears when the page next opens. A package whose Python half
    failed at start-up carries that sentence as ``error``.
    """
    found = []
    for package in workflow_library.installed():
        entry = {key: value for key, value in package.items() if key != "python" and value is not None}
        failed = python_errors.get(package["folder"])
        if not failed and package.get("python") and package["folder"] not in installed_at_start:
            failed = (
                "it was installed while the interface was running; restart the interface "
                "to finish installing it, because its Python half is loaded at start-up"
            )
        if failed and "error" not in entry:
            entry["error"] = failed
        found.append(entry)
    return {"workflows": found}
