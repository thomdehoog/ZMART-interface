"""The workflows installed on this computer: where they live, what is there, and installing one.

A workflow can be written in another repository and shared as a *package*: a
folder holding ``workflow.json``, which says what the workflow is called and
which framework it was written for, and ``flow.bundle.js``, its code built
into one file (``docs/writing-a-workflow.md`` says how to write and build
one). Installing it on a computer is copying that folder into the computer's
workflow library, which is what :func:`register_workflow` does, the way
``zmart_controller.register_driver`` installs a driver. The bridge lists the
library for the page, and the page loads each package without being rebuilt.

The library is ``zmart-interface\\workflows`` under the computer's ZMART
folder (``C:\\ProgramData\\zmart-microscopy`` on Windows, or wherever
``ZMART_MICROSCOPY_ROOT`` points), beside the saved protocols;
``ZMART_WORKFLOW_LIBRARY`` names another folder outright, as
``ZMART_PROTOCOL_LIBRARY`` does for the protocols.

Standard library only, apart from the controller's one function that says
where the ZMART folder is, so ``import zmart_interface`` stays light.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

from zmart_controller.registry import config_root

#: What a package has to carry: its description.
MANIFEST = "workflow.json"

#: What the bundle is called unless the manifest says otherwise.
DEFAULT_BUNDLE = "flow.bundle.js"

#: What a package may hold that the bridge hands out, and what to call each
#: when sent. A short list rather than a guess, because the bridge serves these
#: by a name the page asked for: anything not on it is not part of a package
#: and is not sent.
PACKAGE_FILES = {
    ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
    ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".html": "text/html",
}


def library() -> Path:
    """Where this computer keeps its installed workflows."""
    named = os.environ.get("ZMART_WORKFLOW_LIBRARY")
    return Path(named) if named else config_root() / "zmart-interface" / "workflows"


def read_manifest(package: str | Path) -> dict:
    """The package's ``workflow.json``, checked: what it says, with its bundle found.

    A manifest must name the ``folder`` the workflow is installed as (one
    plain folder name), the workflow's ``name`` and ``version``; it may name
    the ``framework`` version range it was written for, its ``bundle`` file
    (``flow.bundle.js`` unless said otherwise) and a ``python`` module whose
    routes the bridge registers for it. Raises ``ValueError`` naming what is
    missing or wrong, so somebody installing a package learns what to fix.
    """
    where = Path(package).resolve()
    if where.is_dir():
        where = where / MANIFEST
    if not where.is_file():
        raise ValueError(f"a workflow package is installed from its {MANIFEST}; {where} is missing")
    try:
        manifest = json.loads(where.read_text(encoding="utf-8"))
    except ValueError as why:
        raise ValueError(f"{where} is not valid JSON: {why}") from None
    if not isinstance(manifest, dict):
        raise ValueError(f"{where} must hold an object with folder, name and version")
    for key in ("folder", "name", "version"):
        if not isinstance(manifest.get(key), str) or not manifest[key].strip():
            raise ValueError(f"{where} must give the workflow's {key!r} as a non-empty string")
    folder = manifest["folder"]
    if folder != Path(folder).name or folder in (".", "..") or "/" in folder or "\\" in folder:
        raise ValueError(f"{where}: 'folder' must be one plain folder name, not {folder!r}")
    for key in ("framework", "bundle", "python"):
        if key in manifest and not isinstance(manifest[key], str):
            raise ValueError(f"{where}: {key!r} must be a string when given")
    bundle = manifest.get("bundle") or DEFAULT_BUNDLE
    if Path(bundle).name != bundle or Path(bundle).suffix not in (".js", ".mjs"):
        raise ValueError(f"{where}: 'bundle' must name a JavaScript file beside it, not {bundle!r}")
    if not (where.parent / bundle).is_file():
        raise ValueError(f"{where} names the bundle {bundle!r}, which is not beside it; build the workflow first")
    return {**manifest, "bundle": bundle}


def installed() -> list[dict]:
    """Every package in the library, by folder, as the page is told about it.

    Each entry carries the manifest's ``folder``, ``name``, ``version``,
    ``framework`` and ``python``, and ``bundle`` as the route the bridge serves
    it under. A package whose manifest will not read is listed with an
    ``error`` sentence instead of being hidden, so a broken install is seen
    where the operator would look.
    """
    where = library()
    if not where.is_dir():
        return []
    found = []
    for package in sorted(path for path in where.iterdir() if path.is_dir()):
        if not (package / MANIFEST).is_file():
            continue
        try:
            manifest = read_manifest(package)
        except ValueError as why:
            found.append({"folder": package.name, "name": package.name, "error": str(why)})
            continue
        found.append({
            "folder": package.name,
            "name": manifest["name"],
            "version": manifest["version"],
            "framework": manifest.get("framework", "*"),
            "bundle": f"/workflows/{package.name}/{manifest['bundle']}",
            "python": manifest.get("python"),
        })
    return found


def register_workflow(where: str | Path) -> str:
    """Install a built workflow package on this computer, so the page offers it.

    Point at the package folder, or at the ``workflow.json`` inside it. The
    manifest is read first, so a package missing something is refused with
    a sentence saying what, and nothing is copied. Installing a package again
    replaces what was there under its folder. Returns the folder it is
    installed as; the page offers it the next time it opens.
    """
    manifest = read_manifest(where)
    source = Path(where).resolve()
    if source.is_file():
        source = source.parent
    target = library() / manifest["folder"]
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(source, target)
    return manifest["folder"]


def package_file(folder: str, name: str) -> tuple[Path, str] | None:
    """One file of an installed package, and what to call it when sent, or None.

    ``folder`` is the package's folder in the library and ``name`` the file's
    path inside it. Taken apart rather than joined on: a name that reaches
    out of the package, or a kind of file a package does not hold, answers
    None rather than a file this process happened to be able to read.
    """
    if not folder or folder != Path(folder).name or folder in (".", "..") or not name:
        return None
    # A name may reach into a package's own sub-folder, never back up out of
    # one: a step up is refused as written, before anything is resolved.
    if ".." in Path(name).parts:
        return None
    package = (library() / folder).resolve()
    asked = (package / name).resolve()
    if package not in asked.parents or not asked.is_file():
        return None
    kind = PACKAGE_FILES.get(asked.suffix)
    return None if kind is None else (asked, kind)
