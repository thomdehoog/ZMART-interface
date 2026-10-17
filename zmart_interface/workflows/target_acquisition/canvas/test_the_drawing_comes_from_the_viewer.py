"""The page draws with the ZMART viewer's drawing rules, not with copies of them.

The shader programs that turn a stored value into a colour, and the edits that
keep an image's transparency in neuroglancer, are the viewer's. This page used
to keep copies, aligned by hand, and they drifted. Now the build takes them
from the installed viewer (``tools/the-installed-viewer.mjs``), and these tests keep
a copy from coming back.
"""

from __future__ import annotations

import re
from pathlib import Path

import zmart_viewer

CHECKOUT = Path(__file__).resolve().parents[4]
#: The neuroglancer engine, written in JavaScript or, once converted, TypeScript.
ENGINE = next(
    path for path in (CHECKOUT / "zmart_interface/workflows/target_acquisition/canvas/engines/neuroglancer-under").glob("viewer.*")
    if path.suffix in (".js", ".ts")
)


def test_the_installed_viewer_offers_what_the_build_reads():
    drawing = Path(zmart_viewer.__file__).parent / "drawing"
    for name in ("programs.js", "neuroglancer-growth.mjs", "neuroglancer-patches.mjs"):
        assert (drawing / name).is_file(), f"the installed viewer has no {name}"


def test_the_engine_keeps_no_shader_program_of_its_own():
    source = ENGINE.read_text(encoding="utf-8")
    assert 'from "zmart-viewer/drawing/programs.js"' in source
    assert "#uicontrol" not in source.replace(
        "#uicontrol invlerp covered", ""  # the coverage mask is this page's own
    ), "a shader program is written out here again; take it from the viewer's programs.js"


def test_the_patch_keeps_only_what_the_viewer_does_not_offer():
    patch = (CHECKOUT / "patches/neuroglancer+2.41.2.patch").read_text(encoding="utf-8")
    changed = [line.split(" b/", 1)[1] for line in patch.splitlines() if line.startswith("diff --git ")]
    assert changed == ["node_modules/neuroglancer/lib/chunk_manager/frontend.js"], changed
    assert "transparentBackground" not in patch


def test_the_installed_viewer_is_the_pinned_one():
    """The page is built with the viewer release ``pyproject.toml`` names, and no other.

    The build takes the viewer's drawing files from the installed viewer, so a
    different viewer builds a different page. The build itself stops when they
    differ (``tools/the-installed-viewer.mjs``); this says so before the build is run.
    """
    pinned = re.search(
        r'"zmart-viewer @ git\+https://github\.com/ZMB-UZH/ZMART-viewer@v([^"]+)"',
        (CHECKOUT / "pyproject.toml").read_text(encoding="utf-8"),
    )
    assert pinned, "pyproject.toml does not pin zmart-viewer to a release tag"
    assert zmart_viewer.__version__ == pinned[1], (
        f"the installed viewer is {zmart_viewer.__version__}, the pinned one {pinned[1]}"
    )
