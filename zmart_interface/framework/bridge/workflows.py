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

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import importlib

from .. import workflow_library

#: The Python halves that could not be imported or wired when the bridge
#: started, by folder: the sentence each failed with, carried in the listing.
python_errors: dict[str, str] = {}


def load_python_halves(add_route) -> dict[str, str]:
    """Import every installed workflow's Python half and register its routes.

    ``add_route(method, path, handler)`` is the bridge's own way of adding a
    route; each half's routes land under ``/api/<folder>/``. Called once when
    the bridge starts. Answers the errors, by folder, and keeps them for the
    listing; a half that imports cleanly leaves no entry.
    """
    python_errors.clear()
    for package in workflow_library.installed():
        module_name = package.get("python")
        if not module_name or package.get("error"):
            continue
        folder = package["folder"]

        def register(method, path, handler, *, folder=folder):
            add_route(method.upper(), f"/api/{folder}/{str(path).lstrip('/')}", handler)

        try:
            module = importlib.import_module(module_name)
            routes = getattr(module, "routes", None)
            if routes is None:
                raise AttributeError(f"{module_name} has no routes(register) function")
            routes(register)
        except Exception as why:  # noqa: BLE001 -- said in the listing, whatever it was
            python_errors[folder] = f"{type(why).__name__}: {why}"
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
        if failed and "error" not in entry:
            entry["error"] = failed
        found.append(entry)
    return {"workflows": found}
