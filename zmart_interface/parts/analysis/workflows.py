"""Where ZMART-analysis keeps its workflows, and how the interface reaches them.

ZMART-analysis is installed as a package (``engine``: it starts each analysis
step in its own conda environment and keeps it warm), but its workflows --
the pipelines in YAML, the step files, the shared image reader -- are not
part of the package. They stay in a checkout of the ZMART-analysis
repository, with the conda environments each workflow creates for itself.
So the interface has to be told where that checkout is.

It looks in two places, in order:

1. ``ZMART_ANALYSIS_WORKFLOWS``: a folder named in this environment variable,
   either the checkout itself or its ``workflows`` folder.
2. Beside the installed engine: when ZMART-analysis was installed from a
   checkout in editable mode (``pip install -e``), its ``workflows`` folder
   stands next to the ``engine`` package, and is found without being named.

If neither holds the workflows, :func:`workflows_root` says so in a sentence
that tells the operator what to set, rather than failing later with a missing
file in the middle of a focus map.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import importlib.util
import os
from functools import cache
from pathlib import Path
from types import ModuleType

#: The environment variable naming the ZMART-analysis checkout (or its ``workflows`` folder).
ENV = "ZMART_ANALYSIS_WORKFLOWS"


class WorkflowsNotFound(RuntimeError):
    """The ZMART-analysis workflows could not be found; the message says where to point."""


def _holds_workflows(folder: Path) -> bool:
    """Whether *folder* is a ``workflows`` folder: it has at least one pipeline in it."""
    return folder.is_dir() and any(folder.glob("*/pipelines/*.yaml"))


def workflows_root() -> Path:
    """The ZMART-analysis ``workflows`` folder, or :class:`WorkflowsNotFound`."""
    named = os.environ.get(ENV, "").strip()
    if named:
        for candidate in (Path(named), Path(named) / "workflows"):
            if _holds_workflows(candidate):
                return candidate.resolve()
        raise WorkflowsNotFound(
            f"{ENV} points at {named}, which holds no ZMART-analysis workflows; point it at "
            "a checkout of github.com/thomdehoog/ZMART-analysis or at its workflows folder"
        )
    spec = importlib.util.find_spec("engine")
    if spec is not None and spec.origin:
        beside = Path(spec.origin).resolve().parent.parent / "workflows"
        if _holds_workflows(beside):
            return beside
    raise WorkflowsNotFound(
        "the ZMART-analysis workflows were not found. Focus maps and object detection "
        "run them, so clone github.com/thomdehoog/ZMART-analysis and either install it "
        f"from that folder with `pip install -e .`, or set {ENV} to that folder"
    )


def pipeline_yaml(name: str) -> Path:
    """Where a pipeline's YAML is, by its name, under whichever workflow has it.

    A workflow's main pipeline carries the workflow's own name; its variants
    carry that name and a suffix (``object_analysis_fast``), and some live in
    a workflow of another name (``population_plots``, in ``object_analysis``).
    """
    root = workflows_root()
    found = sorted(root.glob(f"*/pipelines/{name}.yaml"))
    if not found:
        raise FileNotFoundError(f"no workflow under {root} has a pipeline {name!r}")
    return found[0]


def step_file(workflow: str, step: str) -> Path:
    """Where one step of a workflow is: ``<workflows>/<workflow>/steps/<step>.py``."""
    path = workflows_root() / workflow / "steps" / f"{step}.py"
    if not path.is_file():
        raise FileNotFoundError(f"the {workflow} workflow has no step {step!r} at {path}")
    return path


@cache
def step_module(workflow: str, step: str) -> ModuleType:
    """One step of a workflow, loaded from its file, the way the engine's worker loads it.

    For running a step in this process rather than in its own environment:
    scoring one stack where numpy and scipy are already loaded. A step file
    finds its workflow's shared modules by itself.
    """
    path = step_file(workflow, step)
    spec = importlib.util.spec_from_file_location(f"zmart_analysis_step_{workflow}_{step}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@cache
def shared_module(name: str) -> ModuleType:
    """One of the workflows' shared modules (``workflows/shared/<name>.py``), loaded by path.

    The image reader the analysis steps use (``image_io``) is also how the
    interface reads a plane of a position for the pictures beside the canvas,
    so the two can never read a stack differently. It is loaded from its file
    under a name of its own, because the ``workflows`` folder is not an
    installed package, and nothing is added to Python's search path.
    """
    path = workflows_root() / "shared" / f"{name}.py"
    if not path.is_file():
        raise FileNotFoundError(f"the ZMART-analysis workflows have no shared module {name!r} at {path}")
    spec = importlib.util.spec_from_file_location(f"zmart_analysis_shared_{name}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
