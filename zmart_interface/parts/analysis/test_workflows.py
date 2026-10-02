"""Finding the ZMART-analysis workflows: named by the environment, or beside the installed engine."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from zmart_interface.parts.analysis import workflows


@pytest.fixture(autouse=True)
def _forget_what_was_loaded():
    workflows.shared_module.cache_clear()
    workflows.step_module.cache_clear()
    yield
    workflows.shared_module.cache_clear()
    workflows.step_module.cache_clear()


def _a_checkout(root):
    (root / "workflows" / "focus" / "pipelines").mkdir(parents=True)
    (root / "workflows" / "focus" / "pipelines" / "focus.yaml").write_text("steps: []\n")
    (root / "workflows" / "shared").mkdir()
    (root / "workflows" / "shared" / "image_io.py").write_text("WHERE = 'the checkout'\n")
    return root


def test_the_environment_variable_names_the_checkout_or_its_workflows(tmp_path, monkeypatch):
    checkout = _a_checkout(tmp_path / "ZMART-analysis")
    monkeypatch.setenv(workflows.ENV, str(checkout))
    assert workflows.workflows_root() == (checkout / "workflows").resolve()
    monkeypatch.setenv(workflows.ENV, str(checkout / "workflows"))
    assert workflows.workflows_root() == (checkout / "workflows").resolve()
    assert workflows.pipeline_yaml("focus").name == "focus.yaml"
    assert workflows.shared_module("image_io").WHERE == "the checkout"


def test_a_folder_without_workflows_is_said_plainly(tmp_path, monkeypatch):
    monkeypatch.setenv(workflows.ENV, str(tmp_path))
    with pytest.raises(workflows.WorkflowsNotFound, match="holds no ZMART-analysis workflows"):
        workflows.workflows_root()


def test_without_the_variable_the_workflows_beside_the_engine_are_used(monkeypatch):
    """An editable install of a ZMART-analysis checkout is found without the variable.

    Installed as a plain package (as on GitHub's machines) the workflows are not
    beside the engine at all, so there is nothing for this test to find.
    """
    monkeypatch.delenv(workflows.ENV, raising=False)
    spec = importlib.util.find_spec("engine")
    if spec is None or not (Path(spec.origin).resolve().parent.parent / "workflows").is_dir():
        pytest.skip("ZMART-analysis is installed as a package here, not as a checkout")
    root = workflows.workflows_root()
    assert root.name == "workflows"
    # The pipelines the interface runs: focus, detection both ways, and the plots.
    for name in ("focus", "object_analysis", "object_analysis_fast", "population_plots"):
        assert workflows.pipeline_yaml(name).is_file(), name
    assert callable(workflows.shared_module("image_io").load_plane)
    with pytest.raises(FileNotFoundError, match="no workflow under"):
        workflows.pipeline_yaml("no_such_pipeline")
