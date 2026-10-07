"""A capture from a microscope that is not the interface's own mock.

The interface promises to work with any microscope the ZMART Controller
drives. What it may rely on is what the controller's contract fixes: an
acquisition lists every file it saved under ``files``, and under ``planes``
says for each picture which file it is in, its channel, depth and moment
(``c``, ``z``, ``t``) and the stage position it was taken at (``x_um``,
``y_um``, ``z_um``). Nothing else -- not the way a driver names its files.

The controller's own mock driver is such a microscope: it fits the contract
and names its files its own way ("A1.ome.tif", "A1_z000.ome.tif"). These
tests take a capture from it and send it down the interface's own paths:
moved into the run, kept as an OME-Zarr position, drawn as the scan's small
picture, and cut into a focus stack's slice copies.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

zmart_controller = pytest.importorskip("zmart_controller")
pytest.importorskip("tifffile")
pytest.importorskip("zarr")

from zmart_controller import check_acquire_answer, utils  # noqa: E402

from zmart_interface.parts.storage.jpeg_tiles import (  # noqa: E402
    make_slice_copies,
    make_what_is_missing,
)
from zmart_interface.parts.storage.output import (  # noqa: E402
    move_record_images,
    prepare_acquisition,
    prepare_experiment,
)
from zmart_interface.parts.storage.zarr_positions import position_store_from_record  # noqa: E402

#: The controller's mock driver lives beside the controller in its checkout,
#: as a test fixture; an installed controller without its tests has none.
MOCK_DRIVER = Path(zmart_controller.__file__).resolve().parents[1] / "tests" / "mock_zmart_driver"
MOCK = ("mock", "mock-scope", "mock-api")

pytestmark = pytest.mark.skipif(
    not MOCK_DRIVER.is_dir(), reason="the controller's mock driver is not beside the controller"
)


@pytest.fixture
def capture(tmp_path, monkeypatch):
    """Take one capture on the controller's mock, the way the bridge asks for one."""
    monkeypatch.setenv("ZMART_MICROSCOPY_ROOT", str(tmp_path / "config"))
    if MOCK not in utils.REGISTRY:
        zmart_controller.register_driver(str(MOCK_DRIVER), remember=False)
    connection = {
        "vendor": "mock", "microscope": "mock-scope", "api": "mock-api",
        "output_root": str(tmp_path / "staging"), "mock_timing": "instant",
    }

    def take(label: str, **settings) -> dict:
        session = zmart_controller.session.set_instrument(connection)
        try:
            session.set_xyz(100.0, 50.0, 3.0)
            answer = session.acquire(
                position_label=label, acquisition_settings={"folder": "overview", **settings}
            )
        finally:
            session.disconnect()
        assert check_acquire_answer(answer) == []
        return answer["content"]

    return take


@pytest.fixture
def run(tmp_path):
    return prepare_experiment(tmp_path / "runs", "any-microscope")


def test_a_capture_from_the_controllers_mock_is_kept_as_a_position(capture, run):
    record = move_record_images(capture("A1"), prepare_acquisition(run, "overview").data)
    store = position_store_from_record(record, run / "positions" / "overview")

    attributes = json.loads((store / "zarr.json").read_text())["attributes"]
    multiscale = attributes["ome"]["multiscales"][0]
    assert [axis["name"] for axis in multiscale["axes"]][-2:] == ["y", "x"]
    assert all(Path(plane["path"]).parent == run / "overview" / "data" for plane in record["planes"])


def test_a_stack_from_the_controllers_mock_keeps_its_depths(capture, run):
    record = capture("B1", z_planes=3, z_step_um=2.0)
    record = move_record_images(record, prepare_acquisition(run, "overview").data)
    store = position_store_from_record(record, run / "positions" / "overview")

    import zarr

    opened = zarr.open(str(store), mode="r")
    assert opened["0"].shape[-3] == 3, "three depths, one per plane the record named"


def test_its_small_picture_is_drawn_where_the_record_says(capture, tmp_path):
    record = capture("C1")
    planes, x_um, y_um = record["planes"], record["planes"][0]["x_um"], record["planes"][0]["y_um"]
    note = make_what_is_missing(tmp_path / "view", {"C1": (planes, (x_um, y_um))})

    tiles = json.loads(note.read_text())["tiles"]
    assert [tile["label"] for tile in tiles] == ["C1"]
    assert tiles[0]["x0"] + tiles[0]["w"] / 2 == pytest.approx(100.0)
    assert tiles[0]["y0"] + tiles[0]["h"] / 2 == pytest.approx(50.0)


def test_its_focus_stack_is_cut_into_slices_at_the_reported_heights(capture, tmp_path):
    record = capture("D1", z_planes=3, z_step_um=2.0)
    slices = make_slice_copies(tmp_path / "focus", record["planes"])

    assert [entry["z_um"] for entry in slices] == [pytest.approx(3.0 + 2.0 * k) for k in range(3)]
    assert all((tmp_path / "focus" / entry["name"]).is_file() for entry in slices)
