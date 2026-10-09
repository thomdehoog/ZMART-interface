"""Installing a workflow package, listing what is installed, and serving it.

A workflow written in another repository reaches a microscope PC as a folder
with a ``workflow.json`` and a built ``flow.bundle.js``. These tests install
such a package into a library of the test's own, read it back the way the
page asks for it, serve its files through the bridge's route, and wire a
Python half's routes under the package's folder. The library is under the
test's ``ZMART_MICROSCOPY_ROOT`` (``conftest.py`` gives every test one), so
nothing here touches the computer's real folder.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import io
import json
import textwrap
from pathlib import Path

import pytest

import zmart_interface
from zmart_interface.framework import workflow_library
from zmart_interface.framework.bridge import server, workflows


def _a_package(where: Path, **over) -> Path:
    """A built workflow package in *where*: its manifest and a tiny bundle."""
    where.mkdir(parents=True, exist_ok=True)
    manifest = {
        "folder": "three_steps", "name": "Three steps", "version": "1.0.0",
        "framework": "^0.1.0", "bundle": "flow.bundle.js", **over,
    }
    manifest = {key: value for key, value in manifest.items() if value is not None}
    (where / "workflow.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (where / "flow.bundle.js").write_text(
        'import { sideGroup } from "zmart-interface/framework/window/panels.js";\n'
        "export const steps = [];\nexport const blurb = 'three steps';\n",
        encoding="utf-8",
    )
    (where / "notes.txt").write_text("not for the page", encoding="utf-8")
    return where


# --- the library ------------------------------------------------------------------


def test_the_library_is_beside_the_protocols_unless_named(tmp_path, monkeypatch):
    root = Path(tmp_path / "machine")
    assert workflow_library.library() == root / "zmart-interface" / "workflows"
    monkeypatch.setenv("ZMART_WORKFLOW_LIBRARY", str(tmp_path / "elsewhere"))
    assert workflow_library.library() == tmp_path / "elsewhere"


def test_registering_copies_the_package_into_the_library_and_lists_it(tmp_path):
    package = _a_package(tmp_path / "built")
    folder = zmart_interface.register_workflow(package)
    assert folder == "three_steps"
    installed = workflow_library.library() / "three_steps"
    assert (installed / "workflow.json").is_file()
    assert (installed / "flow.bundle.js").is_file()
    listed = workflow_library.installed()
    assert listed == [{
        "folder": "three_steps", "name": "Three steps", "version": "1.0.0",
        "framework": "^0.1.0", "bundle": "/workflows/three_steps/flow.bundle.js", "python": None,
    }]


def test_registering_by_the_manifest_file_works_too_and_installing_again_replaces(tmp_path):
    package = _a_package(tmp_path / "built")
    workflow_library.register_workflow(package / "workflow.json")
    _a_package(tmp_path / "built", version="1.1.0")
    (tmp_path / "built" / "extra.css").write_text("p {}", encoding="utf-8")
    workflow_library.register_workflow(package)
    installed = workflow_library.installed()
    assert len(installed) == 1 and installed[0]["version"] == "1.1.0"
    assert (workflow_library.library() / "three_steps" / "extra.css").is_file()


@pytest.mark.parametrize(
    ("over", "said"),
    [
        ({"folder": None}, "'folder'"),
        ({"folder": "../up"}, "one plain folder name"),
        ({"name": ""}, "'name'"),
        ({"version": 3}, "'version'"),
        ({"framework": 1}, "'framework'"),
        ({"bundle": "missing.js"}, "not beside it"),
        ({"bundle": "flow.css"}, "JavaScript file"),
    ],
)
def test_a_package_missing_something_is_refused_with_a_sentence_and_nothing_copied(tmp_path, over, said):
    package = _a_package(tmp_path / "built", **over)
    with pytest.raises(ValueError, match=said):
        workflow_library.register_workflow(package)
    assert not workflow_library.library().exists()


def test_a_folder_with_no_manifest_is_refused(tmp_path):
    with pytest.raises(ValueError, match="workflow.json"):
        workflow_library.register_workflow(tmp_path / "nothing-here")


def test_a_manifest_that_will_not_read_is_listed_with_its_error(tmp_path):
    broken = workflow_library.library() / "broken"
    broken.mkdir(parents=True)
    (broken / "workflow.json").write_text("{not json", encoding="utf-8")
    [listed] = workflow_library.installed()
    assert listed["folder"] == "broken"
    assert "not valid JSON" in listed["error"]


# --- the files a package hands out -------------------------------------------------


def test_only_a_packages_own_page_files_are_handed_out(tmp_path):
    workflow_library.register_workflow(_a_package(tmp_path / "built"))
    found = workflow_library.package_file("three_steps", "flow.bundle.js")
    assert found is not None and found[1] == "text/javascript"
    assert workflow_library.package_file("three_steps", "workflow.json")[1] == "application/json"
    # not a kind of file a package holds for the page
    assert workflow_library.package_file("three_steps", "notes.txt") is None
    # not there
    assert workflow_library.package_file("three_steps", "other.js") is None
    assert workflow_library.package_file("nowhere", "flow.bundle.js") is None
    # reaching out of the package, or out of the library
    assert workflow_library.package_file("three_steps", "../broken/workflow.json") is None
    assert workflow_library.package_file("..", "workflow.json") is None
    assert workflow_library.package_file("", "flow.bundle.js") is None


def _asked_for(paths):
    """Ask the bridge's package route for each path, without a socket."""
    said = {}

    class _Probe(server.Bridge):
        def __init__(self):
            self.sent = None
            self.out = io.BytesIO()

        def _answer(self, payload, status=200):
            self.sent = (status, None)

        def send_response(self, status):
            self.sent = (status, None)

        def send_header(self, name, value):
            if name == "Content-Type":
                self.sent = (self.sent[0], value)

        def end_headers(self):
            pass

        @property
        def wfile(self):
            return self.out

    for path in paths:
        probe = _Probe()
        probe._send_a_package_file(path)
        said[path] = (probe.sent, probe.out.getvalue())
    return said


def test_the_bridge_serves_a_packages_bundle_and_refuses_the_rest(tmp_path):
    workflow_library.register_workflow(_a_package(tmp_path / "built"))
    handed = _asked_for([
        "/workflows/three_steps/flow.bundle.js",
        "/workflows/three_steps/workflow.json",
        "/workflows/three_steps/notes.txt",
        "/workflows/three_steps/../three_steps/flow.bundle.js",
        "/workflows/nowhere/flow.bundle.js",
        "/workflows/three_steps/",
        "/workflows/",
    ])
    status, body = handed["/workflows/three_steps/flow.bundle.js"]
    assert status == (200, "text/javascript")
    assert b"zmart-interface/framework/window/panels.js" in body
    assert handed["/workflows/three_steps/workflow.json"][0] == (200, "application/json")
    for path, (status, _body) in handed.items():
        if path.endswith(("flow.bundle.js", "workflow.json")) and "nowhere" not in path and ".." not in path:
            continue
        assert status[0] == 404, path


# --- the listing the page asks for, and the Python half ------------------------------


def test_the_listing_is_what_the_page_asks_for(tmp_path):
    workflow_library.register_workflow(_a_package(tmp_path / "built"))
    workflows.python_errors.clear()
    listed = server.ROUTES[("GET", "/api/workflows")]({}, "")
    assert listed == {"workflows": [{
        "folder": "three_steps", "name": "Three steps", "version": "1.0.0",
        "framework": "^0.1.0", "bundle": "/workflows/three_steps/flow.bundle.js",
    }]}


def test_an_empty_or_missing_library_lists_nothing():
    assert workflow_library.installed() == []
    assert workflows.listing() == {"workflows": []}


def test_a_python_half_registers_its_routes_under_the_packages_folder(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(tmp_path / "code"))
    (tmp_path / "code").mkdir()
    (tmp_path / "code" / "three_steps_half.py").write_text(textwrap.dedent('''
        def routes(register):
            register("GET", "hello", lambda asked, query: {"hello": "world", "query": query})
            register("post", "/count", lambda asked, query: {"counted": asked["to"]})
    '''), encoding="utf-8")
    workflow_library.register_workflow(_a_package(tmp_path / "built", python="three_steps_half"))
    added = {}
    errors = workflows.load_python_halves(lambda method, path, handler: added.__setitem__((method, path), handler))
    assert errors == {}
    assert set(added) == {("GET", "/api/three_steps/hello"), ("POST", "/api/three_steps/count")}
    assert added[("GET", "/api/three_steps/hello")]({}, "a=1") == {"hello": "world", "query": "a=1"}
    assert added[("POST", "/api/three_steps/count")]({"to": 3}, "") == {"counted": 3}
    # and the listing carries no error for it
    assert "error" not in workflows.listing()["workflows"][0]


def test_a_python_half_that_will_not_import_leaves_the_workflow_listed_with_a_sentence(tmp_path):
    workflow_library.register_workflow(_a_package(tmp_path / "built", python="zmart_interface_nowhere_at_all"))
    errors = workflows.load_python_halves(lambda *route: None)
    assert "ModuleNotFoundError" in errors["three_steps"]
    [listed] = workflows.listing()["workflows"]
    assert listed["name"] == "Three steps"
    assert "ModuleNotFoundError" in listed["error"]


def test_a_python_half_without_routes_is_an_error_too(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(tmp_path / "code"))
    (tmp_path / "code").mkdir()
    (tmp_path / "code" / "quiet_half.py").write_text("x = 1\n", encoding="utf-8")
    workflow_library.register_workflow(_a_package(tmp_path / "built", python="quiet_half"))
    errors = workflows.load_python_halves(lambda *route: None)
    assert "routes(register)" in errors["three_steps"]


def test_building_a_bridge_wires_the_python_halves(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(tmp_path / "code"))
    (tmp_path / "code").mkdir()
    (tmp_path / "code" / "wired_half.py").write_text(
        "def routes(register):\n    register('GET', 'ping', lambda asked, query: {'pong': True})\n",
        encoding="utf-8",
    )
    workflow_library.register_workflow(_a_package(tmp_path / "built", python="wired_half"))
    bridge = server.a_bridge_on(0)
    try:
        assert server.ROUTES[("GET", "/api/three_steps/ping")]({}, "") == {"pong": True}
    finally:
        bridge.server_close()
        server.ROUTES.pop(("GET", "/api/three_steps/ping"), None)


# --- the route table keeps every route the page speaks ----------------------------------


def test_every_route_the_page_speaks_is_in_the_table():
    """The if-chains became a table; nothing the page asks for may have fallen out."""
    expected = {
        ("GET", "/api/setting"), ("GET", "/api/instruments"), ("GET", "/api/info"), ("GET", "/api/xyz"),
        ("GET", "/api/acquisition_settings"), ("GET", "/api/scan"), ("GET", "/api/focus/measure"),
        ("GET", "/api/targets/discover"), ("GET", "/api/plots/compute"), ("GET", "/api/protocols"),
        ("GET", "/api/plots/columns"), ("GET", "/api/targets/acquire"), ("GET", "/api/viewer"),
        ("GET", "/api/workflows"),
        ("POST", "/api/connect"), ("POST", "/api/disconnect"), ("POST", "/api/xyz"), ("POST", "/api/state"),
        ("POST", "/api/acquire"), ("POST", "/api/focus/begin"), ("POST", "/api/focus/score"),
        ("POST", "/api/focus/end"), ("POST", "/api/plots/compute"), ("POST", "/api/plots/compute/stop"),
        ("POST", "/api/protocol"), ("POST", "/api/protocol/save"), ("POST", "/api/protocols"),
        ("POST", "/api/targets/acquire/begin"), ("POST", "/api/targets/acquire/focus"),
        ("POST", "/api/targets/acquire/landed"), ("POST", "/api/targets/acquire/end"),
        ("POST", "/api/targets/discover/stop"), ("POST", "/api/scan"), ("POST", "/api/scan/stop"),
        ("POST", "/api/targets/discover"), ("POST", "/api/targets/raise"),
    }
    assert expected <= set(server.ROUTES), expected - set(server.ROUTES)


def test_the_report_of_installed_workflows_reads_as_sentences(tmp_path):
    assert "no workflows are installed" in server.installed_workflows_report()
    workflow_library.register_workflow(_a_package(tmp_path / "built", python="some.module"))
    report = server.installed_workflows_report()
    assert "three_steps: Three steps 1.0.0 (framework ^0.1.0, Python half some.module)" in report
    assert server.main(["--workflows"]) == 0
