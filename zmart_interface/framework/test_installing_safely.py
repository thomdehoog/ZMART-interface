"""Installing a workflow cannot lose the one installed, and a broken one says why.

From the review of 10 October:

- Finding 12. Registering the installed folder itself deleted it before
  copying it, and a copy that failed halfway left the old version deleted.
  Installing now refuses the installed folder as a source, and copies beside
  the package before swapping, so the old version stays until the new one is
  complete.
- Finding 13. A package whose ``workflow.json`` does not read, and one whose
  Python half does not import, are listed with a sentence that says which.
- Finding 14. A workflow's Python half could replace the bridge's own routes
  (a package in a folder named ``targets`` replaced target discovery), and a
  package installed while the bridge ran was listed as fine although its
  Python half had never been loaded.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import json
import textwrap
from pathlib import Path

import pytest

from zmart_interface.framework import workflow_library
from zmart_interface.framework.bridge import server, workflows


def a_package(where: Path, **over) -> Path:
    """A built workflow package in *where*: its manifest and a tiny bundle."""
    where.mkdir(parents=True, exist_ok=True)
    manifest = {
        "folder": "three_steps", "name": "Three steps", "version": "1.0.0",
        "framework": "^0.1.0", "bundle": "flow.bundle.js", **over,
    }
    (where / "workflow.json").write_text(json.dumps(manifest), encoding="utf-8")
    (where / "flow.bundle.js").write_text("export const steps = [];\n", encoding="utf-8")
    return where


def a_python_half(tmp_path, monkeypatch, name, text):
    code = tmp_path / "code"
    code.mkdir(exist_ok=True)
    (code / f"{name}.py").write_text(textwrap.dedent(text), encoding="utf-8")
    monkeypatch.syspath_prepend(str(code))


# --- finding 12 ---------------------------------------------------------------------


def test_registering_the_installed_folder_itself_is_refused_and_keeps_it(tmp_path):
    workflow_library.register_workflow(a_package(tmp_path / "built"))
    installed = workflow_library.library() / "three_steps"
    with pytest.raises(ValueError, match="already installed"):
        workflow_library.register_workflow(installed)
    assert (installed / "flow.bundle.js").is_file()


def test_a_copy_that_fails_halfway_leaves_the_old_version_installed(tmp_path, monkeypatch):
    workflow_library.register_workflow(a_package(tmp_path / "built"))
    a_package(tmp_path / "newer", version="2.0.0")

    def fails_halfway(source, target, **kw):
        Path(target).mkdir(parents=True)
        (Path(target) / "workflow.json").write_text("{", encoding="utf-8")
        raise OSError("the disk is full")

    monkeypatch.setattr(workflow_library.shutil, "copytree", fails_halfway)
    with pytest.raises(OSError, match="disk is full"):
        workflow_library.register_workflow(tmp_path / "newer")
    [listed] = workflow_library.installed()
    assert listed["version"] == "1.0.0"
    assert sorted(path.name for path in workflow_library.library().iterdir()) == ["three_steps"]


def test_installing_again_still_replaces_the_old_version(tmp_path):
    workflow_library.register_workflow(a_package(tmp_path / "built"))
    workflow_library.register_workflow(a_package(tmp_path / "newer", version="2.0.0"))
    [listed] = workflow_library.installed()
    assert listed["version"] == "2.0.0"
    assert sorted(path.name for path in workflow_library.library().iterdir()) == ["three_steps"]


# --- finding 13 ---------------------------------------------------------------------


def test_a_manifest_that_will_not_read_says_so_in_the_listing():
    broken = workflow_library.library() / "broken"
    broken.mkdir(parents=True)
    (broken / "workflow.json").write_text("{not json", encoding="utf-8")
    workflows.python_errors.clear()
    [listed] = workflows.listing()["workflows"]
    assert listed["error"].startswith("its workflow.json could not be read: ")


def test_a_python_half_that_will_not_import_says_so_in_the_listing(tmp_path):
    workflow_library.register_workflow(a_package(tmp_path / "built", python="nowhere_at_all_half"))
    workflows.load_python_halves(lambda *route: None)
    [listed] = workflows.listing()["workflows"]
    assert listed["error"].startswith("its Python half could not be imported: ModuleNotFoundError")


# --- finding 14 ---------------------------------------------------------------------


def test_a_package_cannot_take_a_folder_the_bridge_uses_itself(tmp_path, monkeypatch):
    a_python_half(tmp_path, monkeypatch, "takeover_half", '''
        def routes(register):
            register("POST", "discover", lambda asked, query: {"taken": True})
    ''')
    workflow_library.register_workflow(
        a_package(tmp_path / "built", folder="targets", python="takeover_half"))
    own = server.ROUTES[("POST", "/api/targets/discover")]
    bridge = server.a_bridge_on(0)
    try:
        assert server.ROUTES[("POST", "/api/targets/discover")] is own
        [listed] = workflows.listing()["workflows"]
        assert "'targets' is a name the interface uses for its own routes" in listed["error"]
    finally:
        bridge.server_close()


def test_a_package_installed_while_the_bridge_runs_says_to_restart(tmp_path, monkeypatch):
    workflows.load_python_halves(lambda *route: None)
    a_python_half(tmp_path, monkeypatch, "late_half", '''
        def routes(register):
            register("GET", "ping", lambda asked, query: {"pong": True})
    ''')
    workflow_library.register_workflow(a_package(tmp_path / "built", python="late_half"))
    [listed] = workflows.listing()["workflows"]
    assert "restart the interface" in listed["error"]


def test_a_package_without_a_python_half_needs_no_restart(tmp_path):
    workflows.load_python_halves(lambda *route: None)
    workflow_library.register_workflow(a_package(tmp_path / "built"))
    [listed] = workflows.listing()["workflows"]
    assert "error" not in listed
