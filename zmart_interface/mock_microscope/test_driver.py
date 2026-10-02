"""The mock microscope, driven through the controller: what it captures, and how it answers.

A focus stack is taken to find a height, not to picture a field: on the
page it stands on the canvas over the predicted-height map, and one as wide
as an overview field hid the map it was measured for. The mock's focussing
frame is a quarter of the overview's area -- half its side -- so the map
stays in view around it, the way a real autofocus window is smaller than
the camera's full frame.

A target's frame is the high-resolution job's: fewer micrometres across than
an overview field and finer pixels over them, so a target on the page reads
as the close look it is.

Every command answers in the controller's two-part shape; the ``session``
fixture reads the reports, as the bridge does.
"""

from __future__ import annotations

import json
import os

import pytest
import zmart_controller
import zmart_controller.session
from zmart_controller import utils
from zmart_controller.utils import check_acquire_answer, validate_driver

from zmart_interface import mock_microscope
from zmart_interface.mock_microscope import driver as mock_driver
from zmart_interface.parts.microscope.instrument import InstrumentDeclined

tifffile = pytest.importorskip("tifffile")
pytest.importorskip("skimage")


@pytest.fixture()
def session(mock_session):
    return mock_session


def test_the_mock_fits_the_controllers_contract(mock_instrument):
    assert validate_driver(mock_instrument) == []


def test_an_acquisition_lists_every_file_it_saved(mock_instrument):
    """``files`` names the images and the state printed beside them, as the controller's contract asks."""
    raw = zmart_controller.session.set_instrument(mock_instrument)
    try:
        answer = raw.acquire(acquisition_type="overview", position_label="P0")
    finally:
        raw.disconnect()
    assert check_acquire_answer(answer) == []
    report = answer["report"]
    assert report["files"] == [plane["path"] for plane in report["planes"]] + report["metadata"]
    assert "images" not in report


def test_the_mock_keeps_its_own_name_beside_the_controllers_mock(tmp_path, monkeypatch):
    """The controller's own pretend microscope (a slide of beads) never takes this one's place.

    The controller's setup guide plugs its mock in once, and the computer
    remembers it. Both used to call themselves mock / mock-scope / mock-api,
    so "Mock" on the page quietly became the bead slide. Here a driver with
    the bead mock's name is plugged in first, then this mock, and the page's
    "Mock" must still be driven by this mock's own functions.
    """
    monkeypatch.setattr(utils, "REGISTRY", dict(utils.REGISTRY))
    beads = tmp_path / "beads" / "zmart_controller"
    beads.mkdir(parents=True)
    (beads / "zmart.json").write_text(json.dumps({"contract": 1, "instruments": [
        {"vendor": "mock", "microscope": "mock-scope", "api": "mock-api"}]}))
    (beads / "__init__.py").write_text("".join(
        f"def {name}(*args, **kwargs):\n    return 'beads'\n" for name in utils.OPS))
    zmart_controller.register_driver(beads.parent, remember=False)

    added = mock_microscope.register()

    assert added == [{**mock_microscope.IDENTITY, "client": "mock-client"}]
    ours = [one for one in zmart_controller.get_instruments() if mock_microscope.is_the_mock(one)]
    assert len(ours) == 1
    ops, _ = utils.resolve(ours[0])
    assert ops["acquire"].__module__.startswith("zmart_interface.mock_microscope")


def test_the_mock_is_known_by_its_whole_name_not_by_its_vendor():
    assert mock_microscope.is_the_mock({**mock_microscope.IDENTITY, "output_root": "x"})
    assert not mock_microscope.is_the_mock({"vendor": "mock", "microscope": "mock-scope", "api": "mock-api"})


def test_every_answer_comes_in_two_parts(mock_instrument):
    raw = zmart_controller.session.set_instrument(mock_instrument)
    try:
        info = raw.get_info()
        assert info["success"] is True
        assert {"output_root", "description", "canvas", "connection_status"} <= set(info["report"])
        assert raw.get_xyz()["report"]["x"]["range"] == list(mock_driver.TRAVEL_UM["x"])
    finally:
        raw.disconnect()


def test_a_move_outside_the_travel_is_declined_and_nothing_moves(mock_instrument, session):
    raw = zmart_controller.session.set_instrument(mock_instrument)
    try:
        answer = raw.set_xyz(10_000_000.0, 0.0, 0.0)
        assert answer["success"] is False
        assert "outside the stage's travel" in answer["report"]["reason"]
        assert raw.get_xyz()["report"]["x"]["value"] == 0.0
    finally:
        raw.disconnect()
    with pytest.raises(InstrumentDeclined, match=r"could not move the stage: x = 1e\+07 um is outside"):
        session.set_xyz(10_000_000.0, 0.0, 0.0)


def test_the_window_is_open_only_while_a_live_window_holds_the_lock(tmp_path):
    state = tmp_path / "instrument.json"
    assert mock_driver.the_window_is_open(state) is False
    mock_driver.claim_the_window(os.getpid(), state)
    assert mock_driver.the_window_is_open(state) is True
    # a lock left by a window that died is not a window
    mock_driver.claim_the_window(2 ** 22 + 12345, state)
    assert mock_driver.the_window_is_open(state) is False
    mock_driver.release_the_window(state)
    assert not mock_driver.where_the_window_stands(state).exists()
    mock_driver.release_the_window(state)


def _frame_px(record) -> int:
    return tifffile.imread(record["planes"][0]["path"]).shape[0]


def test_an_overview_frame_is_the_full_frame(session):
    record = session.acquire(acquisition_type="overview", position_label="P0")
    assert _frame_px(record) == mock_driver._FRAME_PX == 256


@pytest.mark.parametrize("job,kind,depth,spacing,size", [
    ("Overview stack", "overview", 7, 2, 256),
    ("Target stack", "targets", 11, 1, 128),
])
def test_imaging_stack_jobs_capture_real_planes_and_return_to_single_plane(session, job, kind, depth, spacing, size):
    import numpy as np

    session.set_xyz(20_000, 30_000, mock_driver.sharp_height_um(20_000, 30_000))
    session.set_state({"changeable": {"job": job}})
    record = session.acquire(acquisition_type=kind, position_label="stack")
    planes = record["planes"]
    assert len(planes) == depth * 3
    assert {p["z"] for p in planes} == set(range(depth))
    assert {p["c"] for p in planes} == {0, 1, 2}
    heights = sorted({p["z_um"] for p in planes})
    assert np.allclose(np.diff(heights), spacing)
    images = [tifffile.imread(p["path"]) for p in planes if p["c"] == 0]
    assert all(image.shape == (size, size) for image in images)
    assert not np.array_equal(images[0], images[depth // 2])
    session.set_state({"changeable": {"job": job.removesuffix(" stack")}})
    flat = session.acquire(acquisition_type=kind, position_label="flat")
    assert len(flat["planes"]) == 3


def test_a_focus_stack_is_half_the_side_of_an_overview_frame(session):
    record = session.acquire(acquisition_type="focussing", position_label="P0")
    assert _frame_px(record) == mock_driver._FOCUS_FRAME_PX == mock_driver._FRAME_PX // 2
    # Every plane of the stack the same size, and the record's own size says so.
    assert {tifffile.imread(p["path"]).shape for p in record["planes"]} == {(128, 128)}


def test_the_focus_stack_is_still_centred_where_the_stage_stands(session):
    """Smaller, not moved: the store's corner is centre minus half of THIS frame."""
    session.set_xyz(20_000.0, 30_000.0, 0.0)
    record = session.acquire(acquisition_type="focussing", position_label="P1")
    plane = record["planes"][0]
    assert (plane["x_um"], plane["y_um"]) == (20_000.0, 30_000.0)


def test_the_hires_job_images_small_and_fine(session):
    """The job owns the geometry: on Target a capture is 128 px of 1 um, an
    eighth of the overview field across, and the readout says so before
    anything is captured."""
    session.set_state({"changeable": {"job": "Target"}})
    observed = session.get_state()["observed"]
    assert observed["frame_size"]["x"] == 128.0 and observed["pixel_size"]["x"] == 1.0
    record = session.acquire(acquisition_type="targets", position_label="T0")
    assert _frame_px(record) == 128
    with tifffile.TiffFile(record["planes"][0]["path"]) as held:
        physical = held.ome_metadata
    assert 'PhysicalSizeX="1.0"' in physical
    session.set_state({"changeable": {"job": "Overview"}})
    assert session.get_state()["observed"]["frame_size"]["x"] == 1024.0


def test_a_target_frame_is_the_same_tissue_looked_at_closer(session):
    """The target's centre pixel and the overview's are one recorded pixel:
    magnification, not a different place."""
    import numpy as np

    # In focus, so neither frame is softened: blur is drawn in pixels, and
    # the two frames' pixels are not the same size.
    session.set_xyz(20_000.0, 30_000.0, mock_driver.sharp_height_um(20_000.0, 30_000.0))
    overview = tifffile.imread(session.acquire(acquisition_type="overview", position_label="P0")["planes"][0]["path"])
    session.set_state({"changeable": {"job": "Target"}})
    target = tifffile.imread(session.acquire(acquisition_type="targets", position_label="T0")["planes"][0]["path"])
    assert target[64, 64] == overview[128, 128]
    # Four target pixels to one overview pixel in each direction: every
    # fourth target pixel is the overview's, over the 32 recorded pixels the
    # target's 128 fine ones cover.
    assert np.array_equal(target[::4, ::4], overview[112:144, 112:144])


def test_the_settings_live_in_the_file_and_whoever_wrote_last_wins(session):
    """The mock's LAS X is a file: the mock instrument window writes it and
    the driver reads it back on every readout and capture, so a job chosen
    there with no session open is the job the next session stands on. And
    ``set_state`` writes the same file, so the two never disagree."""
    where = mock_driver.where_the_instrument_stands()
    session.set_state({"changeable": {"job": "Target"}})
    assert mock_driver.read_instrument_settings(where)["job"] == "Target"
    mock_driver.write_instrument_settings({"job": "Focussing"}, where)
    assert session.get_state()["changeable"]["job"] == "Focussing"
    assert session.get_acquisition_options()["job"]["active"] == "Focussing"
    record = session.acquire(acquisition_type="overview", position_label="P0")
    assert record["job"] == "Focussing"
    with pytest.raises(ValueError):
        mock_driver.write_instrument_settings({"job": "HiRes"}, where)


def test_the_focussing_job_images_a_stacks_frame(session, tmp_path):
    """Under the Focussing job a stack is 256 um of 1 um pixels, whole: the
    job's frame is the stack's frame, not halved again."""
    session.set_state({"changeable": {"job": "Focussing"}})
    assert session.get_state()["observed"]["frame_size"]["x"] == 256.0
    record = session.acquire(acquisition_type="focussing", position_label="F0")
    assert _frame_px(record) == 256
