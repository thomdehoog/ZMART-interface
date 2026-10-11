"""A driver that saves a capture as one OME-Zarr image: the interface keeps that one copy.

A driver may offer ``"ome-zarr"`` in its ``format`` setting. The interface
then asks for it, and the capture arrives as one OME-Zarr 0.5 store, every
plane's ``path`` pointing into it with ``c``, ``z``, ``t`` as the index (the
controller's acquire contract). The interface uses that store as it is --
for the viewer, the small pictures and the analysis -- and writes no copy
of its own. A driver that offers only OME-TIFF is converted as before.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

zarr = pytest.importorskip("zarr")
models = pytest.importorskip("ome_zarr_models.v05.image")

from ome_zarr_models.v05.axes import Axis  # noqa: E402
from pydantic_zarr.v3 import ArraySpec  # noqa: E402

from zmart_interface.framework.bridge import pictures, state  # noqa: E402
from zmart_interface.parts.microscope.instrument import Instrument  # noqa: E402
from zmart_interface.parts.storage import viewer_service  # noqa: E402
from zmart_interface.parts.storage.jpeg_tiles import make_what_is_missing  # noqa: E402


def a_driver_store(data: Path, name: str, pixels: np.ndarray, *, pixel_um: float = 2.0) -> Path:
    """An OME-Zarr 0.5 image as a driver writes one: axes t, c, z, y, x, one level."""
    store = data / name
    spec = ArraySpec.from_array(
        pixels, dimension_names=list("tczyx"), codecs=[{"name": "bytes", "configuration": {"endian": "little"}}],
    )
    image = models.Image.new(
        array_specs=[spec],
        paths=["0"],
        axes=[
            Axis(name="t", type="time", unit="second"),
            Axis(name="c", type="channel"),
            Axis(name="z", type="space", unit="micrometer"),
            Axis(name="y", type="space", unit="micrometer"),
            Axis(name="x", type="space", unit="micrometer"),
        ],
        scales=[[1.0, 1.0, 1.0, pixel_um, pixel_um]],
        translations=[[0.0, 0.0, 0.0, 0.0, 0.0]],
        multiscale_type="mean",
    )
    image.to_zarr(zarr.storage.LocalStore(str(store)), path="")["0"][...] = pixels
    return store


def a_record_from(store: Path, *, channels: int, label: str = "A1") -> dict:
    planes = [
        {"path": str(store), "t": 0, "z": 0, "c": c, "x_um": 100.0, "y_um": 50.0, "z_um": 3.0}
        for c in range(channels)
    ]
    return {"position_label": label, "files": [str(store)], "planes": planes, "format": "ome-zarr"}


@pytest.fixture
def run(tmp_path, monkeypatch):
    monkeypatch.setattr(state, "run", tmp_path / "run")
    (tmp_path / "run" / "overview" / "data").mkdir(parents=True)
    return tmp_path / "run"


@pytest.fixture
def announced(monkeypatch):
    told = []
    monkeypatch.setattr(
        viewer_service, "a_position_landed",
        lambda kind, folder, *, store: told.append((kind, Path(folder), Path(store))),
    )
    return told


def test_the_drivers_store_is_used_and_no_copy_is_made(run, announced):
    pixels = np.arange(2 * 64 * 64, dtype=np.uint16).reshape(1, 2, 1, 64, 64)
    store = a_driver_store(run / "overview" / "data", "overview_000001_A1.ome.zarr", pixels)
    record = a_record_from(store, channels=2)

    pictures.keep_position_as_zarr(record, "overview")

    assert "zarr_error" not in record
    assert record["zarr"] == str(store)
    assert record["frame_um"] == pytest.approx(64 * 2.0)
    assert not (run / "positions").exists(), "no second copy of the capture"
    assert announced == [("overview", store.parent, store)]


def test_a_tiff_capture_is_still_converted(run, announced, monkeypatch):
    converted = []
    monkeypatch.setattr(
        pictures, "position_store_from_record",
        lambda record, folder, *, pixel_provider=None: converted.append(folder) or Path(folder) / "x.ome.zarr",
    )
    monkeypatch.setattr(pictures, "frame_um_of", lambda store: 1.0)
    record = {"position_label": "A1", "planes": [{"path": str(run / "a.ome.tif"), "c": 0, "z": 0, "t": 0}]}

    pictures.keep_position_as_zarr(record, "overview")

    assert converted == [run / "positions" / "overview"]


def test_the_small_picture_is_drawn_from_the_store(tmp_path):
    pixels = np.zeros((1, 2, 1, 64, 64), dtype=np.uint16)
    pixels[0, 0, 0, 10:20, 10:20] = 4000
    store = a_driver_store(tmp_path / "data", "overview_000001_C1.ome.zarr", pixels)
    record = a_record_from(store, channels=2, label="C1")

    note = make_what_is_missing(tmp_path / "view", {"C1": (record["planes"], (100.0, 50.0))})

    [tile] = json.loads(note.read_text())["tiles"]
    assert tile["label"] == "C1"
    assert tile["w"] == pytest.approx(64 * 2.0)
    assert tile["x0"] + tile["w"] / 2 == pytest.approx(100.0)


def test_a_rerun_stops_showing_the_drivers_stores_but_never_deletes_them(run, monkeypatch):
    store = a_driver_store(
        run / "overview" / "data", "overview_000001_A1.ome.zarr", np.zeros((1, 1, 1, 8, 8), np.uint16)
    )
    forgotten = []
    monkeypatch.setattr(viewer_service, "forget_stores", lambda kind, keeping: forgotten.append((kind, keeping)))
    monkeypatch.setattr(viewer_service, "stores_were_retired", lambda kind, folder: None)

    pictures.replace_the_acquisition("overview", keeping=set())

    assert store.is_dir(), "a driver's store is the capture itself, and stays"
    assert forgotten == [("overview", set())]


def test_forgetting_drops_a_kinds_stores_from_what_the_viewer_is_handed(monkeypatch, tmp_path):
    monkeypatch.setitem(viewer_service._viewer, "source_versions", {
        ("overview", "overview_000001_A1.ome.zarr"): 1,
        ("overview", "overview_x_A2.ome.zarr"): 2,
        ("targets", "targets_000002_T1.ome.zarr"): 1,
    })
    monkeypatch.setitem(viewer_service._viewer, "source_order", {
        "overview": ["overview_000001_A1.ome.zarr", "overview_x_A2.ome.zarr"],
        "targets": ["targets_000002_T1.ome.zarr"],
    })
    monkeypatch.setitem(viewer_service._viewer, "folder_types", {str(tmp_path / "data"): "overview"})
    monkeypatch.setitem(viewer_service._viewer, "pending", set())
    monkeypatch.setitem(viewer_service._viewer, "wake", type("Wake", (), {"set": lambda self: None})())

    viewer_service.forget_stores("overview", keeping={"overview_x_A2.ome.zarr"})

    assert set(viewer_service._viewer["source_versions"]) == {
        ("overview", "overview_x_A2.ome.zarr"), ("targets", "targets_000002_T1.ome.zarr"),
    }
    assert viewer_service._viewer["source_order"]["overview"] == ["overview_x_A2.ome.zarr"]
    assert viewer_service._viewer["pending"] == {str(tmp_path / "data")}


class FakeSession:
    def __init__(self, formats):
        self.formats = formats
        self.asked = None
        self.context = {"driver": "a driver"}

    def get_acquisition_settings(self):
        return {"success": True, "content": {
            "folder": {"options": "text", "active": "scan"},
            "format": {"options": self.formats, "active": self.formats[0]},
        }}

    def acquire(self, *, position_label, acquisition_settings):
        self.asked = acquisition_settings
        return {"success": True, "content": {}}


@pytest.mark.parametrize(("formats", "one_copy", "asked"), [
    (["ome-tiff", "ome-zarr"], True, "ome-zarr"),
    (["ome-tiff"], True, None),
    (["ome-tiff", "ome-zarr"], False, None),
])
def test_the_interface_asks_for_one_store_when_the_driver_can_write_it(formats, one_copy, asked):
    session = FakeSession(formats)
    instrument = Instrument(session)
    instrument.keeps_one_copy = one_copy

    instrument.acquire_answer(position_label="A1", folder="overview")

    assert session.asked.get("format") == asked
    assert session.asked["folder"] == "overview"
