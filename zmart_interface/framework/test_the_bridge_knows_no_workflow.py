"""The bridge's general part imports nothing of any workflow.

The twin of ``knows-no-workflow.test.js``, which keeps the page's framework
free of workflows. Until 11 October 2026 the bridge held Target
acquisition's focus map, scans, discovery, plots, target run and protocols
in its general part; they moved into the workflow's own Python half
(``zmart_interface/workflows/target_acquisition/bridge``), and the general
part learns what it needs through ``framework/bridge/hooks.py``. This test
reads the general part's modules and refuses an import of anything under
``zmart_interface.workflows``, however it is written, so the tie cannot come
back without a red test saying where.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

FRAMEWORK = Path(__file__).resolve().parent
PACKAGE = "zmart_interface.framework"


def modules_of_the_framework() -> list[Path]:
    """Every Python module of the framework, leaving out the tests beside it."""
    return sorted(
        path for path in FRAMEWORK.rglob("*.py")
        if not path.name.startswith("test_") and path.name != "conftest.py"
        and "__pycache__" not in path.parts and "build" not in path.parts
    )


def imported_by(path: Path) -> list[str]:
    """The full names of the modules ``path`` imports, relative imports resolved."""
    here = f"{PACKAGE}.{'.'.join(path.relative_to(FRAMEWORK).with_suffix('').parts)}"
    package = here if path.name == "__init__.py" else here.rpartition(".")[0]
    names = []
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            names += [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            base = node.module or ""
            if node.level:
                parent = package.rsplit(".", node.level - 1)[0] if node.level > 1 else package
                base = f"{parent}.{base}" if base else parent
            names += [base, *(f"{base}.{alias.name}" for alias in node.names)]
    return names


def test_there_are_modules_to_read():
    assert len(modules_of_the_framework()) > 10


@pytest.mark.parametrize("path", modules_of_the_framework(), ids=lambda path: path.relative_to(FRAMEWORK).as_posix())
def test_a_framework_module_imports_no_workflow(path):
    workflows = [name for name in imported_by(path) if name.startswith("zmart_interface.workflows")]
    assert workflows == [], f"{path.relative_to(FRAMEWORK)} imports {workflows}"


#: What would tie the framework to one instrument: the interface's own mock
#: microscope and the LAS X simulator's stand-in pixels. Whoever starts the
#: bridge hands those over (``zmart_interface/serving.py``).
ONE_INSTRUMENT = ("zmart_interface.mock_microscope", "zmart_interface.parts.microscope.simulator")


@pytest.mark.parametrize("path", modules_of_the_framework(), ids=lambda path: path.relative_to(FRAMEWORK).as_posix())
def test_a_framework_module_imports_no_instrument(path):
    instruments = [name for name in imported_by(path) if name.startswith(ONE_INSTRUMENT)]
    assert instruments == [], f"{path.relative_to(FRAMEWORK)} imports {instruments}"


def test_the_check_would_catch_a_relative_import(tmp_path, monkeypatch):
    """The positive control: a relative import of a workflow is seen for what it is."""
    sneaky = FRAMEWORK / "bridge" / "sneaky_example_for_the_test.py"
    monkeypatch.setattr(Path, "read_text", lambda self, encoding=None: "from ...workflows.target_acquisition import bridge\n")
    assert "zmart_interface.workflows.target_acquisition" in imported_by(sneaky)
