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
fixture reads the content of each, as the bridge does.
"""

from __future__ import annotations

import os

import pytest
import zmart_controller
import zmart_controller.session
from zmart_controller.utils import check_acquire_answer, validate_driver

from zmart_interface import mock_microscope
from zmart_interface.mock_microscope import driver as mock_driver

tifffile = pytest.importorskip("tifffile")
pytest.importorskip("skimage")


@pytest.fixture()
def session(mock_session):
    return mock_session


def test_the_mock_fits_the_controllers_contract(mock_instrument):
    assert validate_driver(mock_microscope, mock_instrument) == []


def test_an_acquisition_lists_every_file_it_saved(mock_instrument):
    """``files`` names the images and the state printed beside them, as the controller's contract asks."""
    raw = zmart_controller.session.set_instrument(mock_microscope, mock_instrument)
    try:
        answer = raw.acquire(position_label="P0", acquisition_settings={"folder": "overview"})
    finally:
        raw.disconnect()
    assert check_acquire_answer(answer) == []
    content = answer["content"]
    assert content["files"] == [plane["path"] for plane in content["planes"]] + content["metadata"]
    assert "images" not in content


def test_the_folder_setting_says_where_the_files_go(mock_instrument):
    """``folder`` groups a capture's files; left empty, they go straight into the output folder."""
    raw = zmart_controller.session.set_instrument(mock_microscope, mock_instrument)
    try:
        assert raw.get_acquisition_settings()["content"]["folder"]["active"] == ""
        grouped = raw.acquire(position_label="P0", acquisition_settings={"folder": "overview"})
        loose = raw.acquire(position_label="P1")
    finally:
        raw.disconnect()
    root = os.path.realpath(mock_instrument["output_root"])
    first = grouped["content"]["planes"][0]["path"]
    assert os.path.realpath(first).startswith(os.path.join(root, "overview", "data") + os.sep)
    assert os.path.dirname(os.path.realpath(loose["content"]["planes"][0]["path"])) == root
    assert "acquisition_type" not in grouped["content"]


def test_a_stack_says_which_depth_and_height_each_picture_is(mock_instrument):
    """Every plane of a focus stack fits the controller's ``planes`` contract, one depth each."""
    raw = zmart_controller.session.set_instrument(mock_microscope, mock_instrument)
    try:
        answer = raw.acquire(position_label="F0", acquisition_settings={"folder": "focussing"})
    finally:
        raw.disconnect()
    assert check_acquire_answer(answer) == []
    planes = answer["content"]["planes"]
    assert [plane["z"] for plane in planes] == list(range(len(planes)))
    heights = [plane["z_um"] for plane in planes]
    assert heights == sorted(heights) and len(set(heights)) == len(planes) > 1


def test_the_canvas_holds_a_picture_taken_anywhere_the_stage_can_go(mock_instrument):
    """get_xyz's canvas is the whole travel, and half the widest field and deepest stack beyond it.

    The viewer refuses, whole, a capture that shows outside the area it was
    laid out with, and the interface lays that area out from this canvas. A
    stage standing at the edge of its travel takes a field that shows half
    its width further, and a stack half its depth, so any smaller canvas loses
    those pictures.
    """
    widest = max(px * um for px, um in (mock_driver.frame_of(job, "overview") for job in mock_driver.JOBS))
    stacks = [{"z_planes": 1, "z_step_um": 0.0}, *mock_driver.JOB_STACKS.values()]
    deepest = max((one["z_planes"] - 1) * one["z_step_um"] for one in stacks)
    raw = zmart_controller.session.set_instrument(mock_microscope, mock_instrument)
    try:
        report = raw.get_xyz()["content"]
    finally:
        raw.disconnect()
    for axis, half in (("x", widest / 2), ("y", widest / 2), ("z", deepest / 2)):
        low, high = mock_driver.TRAVEL_UM[axis]
        assert report[axis] == {
            "value": report[axis]["value"], "actuator": report[axis]["actuator"],
            "canvas": [low - half, high + half],
        }, axis
    assert deepest > 0, "the mock takes stacks, so z's canvas goes past the travel"


def test_the_mock_says_nothing_of_a_canvas_in_get_info(mock_instrument):
    """The area pictures can cover is get_xyz's, per axis; get_info no longer carries a copy."""
    raw = zmart_controller.session.set_instrument(mock_microscope, mock_instrument)
    try:
        assert "canvas" not in raw.get_info()["content"]
    finally:
        raw.disconnect()


def test_a_field_taken_before_the_stage_has_moved_lies_within_the_canvas(mock_instrument):
    """Right after Connect, where an operator may first press Acquire, the field is on the canvas."""
    raw = zmart_controller.session.set_instrument(mock_microscope, mock_instrument)
    try:
        canvas = raw.get_xyz()["content"]
        report = raw.acquire(position_label="P0", acquisition_settings={"folder": "overview"})["content"]
    finally:
        raw.disconnect()
    plane = report["planes"][0]
    height, width = tifffile.imread(plane["path"]).shape
    for axis, across in (("x", width), ("y", height)):
        half = across * 4.0 / 2
        low, high = canvas[axis]["canvas"]
        assert low <= plane[f"{axis}_um"] - half and plane[f"{axis}_um"] + half <= high


def test_every_answer_comes_in_two_parts(mock_instrument):
    raw = zmart_controller.session.set_instrument(mock_microscope, mock_instrument)
    try:
        info = raw.get_info()
        assert info["success"] is True
        assert {"output_root", "description", "connection_status"} <= set(info["content"])
        assert set(raw.get_xyz()["content"]["x"]) == {"value", "actuator", "canvas"}
    finally:
        raw.disconnect()


def test_a_move_outside_the_travel_is_refused_and_nothing_moves(mock_instrument):
    """The canvas is wider than the travel; a move past the travel is a mistake, refused before moving."""
    raw = zmart_controller.session.set_instrument(mock_microscope, mock_instrument)
    try:
        with pytest.raises(ValueError, match=r"x = 1e\+07 um is outside the stage's travel"):
            raw.set_xyz(10_000_000.0, 0.0, 0.0)
        assert raw.get_xyz()["content"]["x"]["value"] == 0.0
    finally:
        raw.disconnect()


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
    record = session.acquire(folder="overview", position_label="P0")
    assert _frame_px(record) == mock_driver._FRAME_PX == 256


@pytest.mark.parametrize("job,kind,depth,spacing,size", [
    ("Overview stack", "overview", 7, 2, 256),
    ("Target stack", "targets", 11, 1, 128),
])
def test_imaging_stack_jobs_capture_real_planes_and_return_to_single_plane(session, job, kind, depth, spacing, size):
    import numpy as np

    session.set_xyz(20_000, 30_000, mock_driver.sharp_height_um(20_000, 30_000))
    session.set_state({"changeable": {"job": job}})
    record = session.acquire(folder=kind, position_label="stack")
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
    flat = session.acquire(folder=kind, position_label="flat")
    assert len(flat["planes"]) == 3


def test_a_focus_stack_is_half_the_side_of_an_overview_frame(session):
    record = session.acquire(folder="focussing", position_label="P0")
    assert _frame_px(record) == mock_driver._FOCUS_FRAME_PX == mock_driver._FRAME_PX // 2
    # Every plane of the stack the same size, and the record's own size says so.
    assert {tifffile.imread(p["path"]).shape for p in record["planes"]} == {(128, 128)}


def test_the_focus_stack_is_still_centred_where_the_stage_stands(session):
    """Smaller, not moved: the store's corner is centre minus half of THIS frame."""
    session.set_xyz(20_000.0, 30_000.0, 0.0)
    record = session.acquire(folder="focussing", position_label="P1")
    plane = record["planes"][0]
    assert (plane["x_um"], plane["y_um"]) == (20_000.0, 30_000.0)


def test_the_hires_job_images_small_and_fine(session):
    """The job owns the geometry: on Target a capture is 128 px of 1 um, an
    eighth of the overview field across, and the readout says so before
    anything is captured."""
    session.set_state({"changeable": {"job": "Target"}})
    observed = session.get_state()["observed"]
    assert observed["frame_size"]["x"] == 128.0 and observed["pixel_size"]["x"] == 1.0
    record = session.acquire(folder="targets", position_label="T0")
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
    overview = tifffile.imread(session.acquire(folder="overview", position_label="P0")["planes"][0]["path"])
    session.set_state({"changeable": {"job": "Target"}})
    target = tifffile.imread(session.acquire(folder="targets", position_label="T0")["planes"][0]["path"])
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
    assert session.get_acquisition_settings()["job"]["active"] == "Focussing"
    record = session.acquire(folder="overview", position_label="P0")
    assert record["job"] == "Focussing"
    with pytest.raises(ValueError):
        mock_driver.write_instrument_settings({"job": "HiRes"}, where)


def test_the_focussing_job_images_a_stacks_frame(session, tmp_path):
    """Under the Focussing job a stack is 256 um of 1 um pixels, whole: the
    job's frame is the stack's frame, not halved again."""
    session.set_state({"changeable": {"job": "Focussing"}})
    assert session.get_state()["observed"]["frame_size"]["x"] == 256.0
    record = session.acquire(folder="focussing", position_label="F0")
    assert _frame_px(record) == 256
