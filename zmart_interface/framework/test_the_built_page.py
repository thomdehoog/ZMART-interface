"""The built page: what is committed is what the build makes, every time.

The page the bridge hands out lives in ``window/build`` and is committed, so a
microscope PC can install the interface without Node.js. That only holds if
the committed files are exactly what ``npm run build`` makes from the sources
beside them: a change to the page that was never rebuilt, or a build that
comes out differently each time, would ship a page nobody has tested.

The first test reads only the committed page and always runs. The second
builds the page twice and needs Node.js and ``npm ci`` in this checkout; it
skips, saying so, without them.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from zmart_interface.framework.bridge import THE_PAGE

CHECKOUT = Path(__file__).resolve().parents[2]


def _digest(folder: Path) -> dict[str, str]:
    """Every file under *folder*, by its path inside it, with its SHA-256."""
    return {
        path.relative_to(folder).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(folder.rglob("*"))
        if path.is_file()
    }


def test_the_committed_page_is_three_files_with_neuroglancers_programs_compiled():
    """The page, and neuroglancer's two background programs beside it, ready to run.

    The background programs arrive from npm as twenty-line lists of imports a
    browser cannot follow; the build compiles them (``neuroglancer-workers.mjs``).
    A page shipped with the lists instead opens and never draws, and says nothing.
    """
    names = sorted(_digest(THE_PAGE))
    workers = [name for name in names if name.endswith(".bundle.js") or ".bundle-" in name]
    assert "index.html" in names and len(names) == 3, names
    assert "async_computation.bundle.js" in workers, names
    assert any(name.startswith("chunk_worker.bundle-") for name in workers), names
    for name in workers:
        text = (THE_PAGE / name).read_text(encoding="utf-8")
        assert 'import "#src/' not in text and len(text) > 500_000, (
            f"{name} is neuroglancer's uncompiled list, not a finished program"
        )


def _npm() -> str | None:
    return shutil.which("npm") or shutil.which("npm.cmd")


@pytest.mark.skipif(
    _npm() is None or not (CHECKOUT / "node_modules" / "vite").is_dir(),
    reason="needs Node.js, and `npm ci` run in this checkout",
)
def test_building_twice_gives_the_committed_page(tmp_path):
    """Two fresh builds agree with each other and with the committed page, byte for byte.

    The build reads neuroglancer's patches from the installed ZMART viewer, so
    it runs with this Python, the one the viewer is installed in.
    """
    built = []
    for attempt in ("first", "second"):
        out = tmp_path / attempt
        finished = subprocess.run(
            f'"{_npm()}" run build -- --outDir "{out}" --emptyOutDir',
            cwd=CHECKOUT,
            shell=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env={**os.environ, "NO_COLOR": "1", "PYTHON": sys.executable},
        )
        assert finished.returncode == 0, finished.stdout + finished.stderr
        built.append(_digest(out))
    assert built[0] == built[1], "two builds of the same sources differ"
    assert built[0] == _digest(THE_PAGE), (
        "the committed page is not what the build makes: run `npm run build` and commit "
        "zmart_interface/framework/window/build"
    )
