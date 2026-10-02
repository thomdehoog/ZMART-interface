"""One focus stack in hand: filed, scored, and reported in the frame the stage drives in."""

from __future__ import annotations

import json

import pytest

from zmart_interface.parts.microscope.focus_run import as_state, measure_one_stack
from zmart_interface.parts.microscope.simulator_guard import NonSimulatorFrameError
from zmart_interface.parts.storage.output import prepare_acquisition, prepare_experiment


def a_stack(folder, *, centre=0.0, heights=None, sharp=1.0, label="P0"):
    """A captured stack as a driver answers it: five planes around *centre*,
    each a real file, and the height the sample is sharp at for the stub scorer."""
    heights = heights if heights is not None else [centre + (i - 2) * 1.0 for i in range(5)]
    planes = []
    for index, z in enumerate(heights):
        path = folder / f"focussing_abc123_{label}_T000000_C00_Z{index:05d}.ome.tiff"
        path.write_bytes(b"pixels")
        planes.append({"t": 0, "z": index, "c": 0, "z_um": z, "path": str(path)})
    return {
        "acquisition_type": "focussing", "acquisition_hash": "abc123", "position_label": label,
        "files": [plane["path"] for plane in planes], "planes": planes, "sharp": sharp,
    }


def _score(record):
    """A stand-in for ZMART-analysis: hands back the height the stack was made sharp at."""
    return {"z_um": record["sharp"], "traces": {"brenner": {"samples": []}}}


def test_a_stack_comes_back_as_a_point_of_the_map(tmp_path):
    measured = measure_one_stack(a_stack(tmp_path, sharp=1.5), x=10.0, y=20.0, centre=0.0, score=_score)
    assert (measured["x_um"], measured["y_um"], measured["z_um"]) == (10.0, 20.0, 1.5)
    # A height alone cannot be argued with; the curve is how it shows its work.
    assert measured["traces"] == {"brenner": {"samples": []}}
    assert [plane["z_um"] for plane in measured["planes"]] == [-2.0, -1.0, 0.0, 1.0, 2.0]


def test_a_sweep_answered_in_its_own_frame_comes_back_in_the_drives(tmp_path):
    """The Leica files a stack's planes as -2..+2 around the height it was
    driven to, and the analysis answers on that axis. What comes back is
    stage z -- the surface and the scan drive with it -- so the peak, the
    curves and the planes all move together."""
    record = a_stack(tmp_path, heights=[-2.0, -1.0, 0.0, 1.0, 2.0])

    def relative(_record):
        return {"z_um": 1.4, "traces": {"brenner": {
            "samples": [{"z": -2.0, "s": 1.0}, {"z": 2.0, "s": 9.0}], "peak_z_um": 1.4,
        }}}

    measured = measure_one_stack(record, x=0.0, y=0.0, centre=5781.8, score=relative)
    assert measured["z_um"] == pytest.approx(5781.8 + 1.4)
    assert measured["z_shift_um"] == pytest.approx(5781.8)
    curve = measured["traces"]["brenner"]
    assert [s["z"] for s in curve["samples"]] == [pytest.approx(5779.8), pytest.approx(5783.8)]
    assert curve["peak_z_um"] == pytest.approx(5781.8 + 1.4)
    assert [p["z_um"] for p in measured["planes"]] == [
        pytest.approx(5781.8 + d) for d in (-2.0, -1.0, 0.0, 1.0, 2.0)]


def test_a_stack_nothing_could_be_chosen_from_reports_no_height(tmp_path):
    """A made-up height is worse than a missing one: the surface would believe it."""
    measured = measure_one_stack(
        a_stack(tmp_path), x=0.0, y=0.0, centre=0.0, score=lambda record: {"z_um": None, "traces": {}},
    )
    assert measured["z_um"] is None


def test_a_stack_that_cannot_be_scored_is_lost_not_fatal(tmp_path):
    def broken(_record):
        raise ValueError("one plane cannot be focused")

    measured = measure_one_stack(a_stack(tmp_path), x=0.0, y=0.0, centre=0.0, score=broken)
    assert measured["z_um"] is None and measured["traces"] is None


def test_the_stack_is_filed_under_the_run_and_its_measurement_kept_beside_it(tmp_path):
    run = prepare_experiment(tmp_path / "out", "target-acquisition", hash6="abc123")
    output = prepare_acquisition(run, "focussing")
    staging = tmp_path / "staging"
    staging.mkdir()
    record = a_stack(staging, sharp=0.5)
    kept = []
    measured = measure_one_stack(record, x=1.0, y=2.0, centre=0.0, score=_score,
                                 output=output, keep=kept.append, cost={"capture": 0.25})
    assert kept == [record], "the caller keeps every landed stack, scored or not"
    assert all(str(output.data) in plane["path"] for plane in record["planes"])
    written = json.loads(next((output.root / "analysis").glob("*_focus.json")).read_text())
    assert written["z_um"] == 0.5 and written["x_um"] == 1.0
    assert set(measured["cost_s"]) == {"capture", "score"}


def test_a_simulator_refusal_while_keeping_stops_the_map(tmp_path):
    """Synthetic pixels refused on a real frame must stop the run, never be filed as one lost point."""
    run = prepare_experiment(tmp_path / "out", "target-acquisition", hash6="abc123")
    staging = tmp_path / "staging"
    staging.mkdir()

    def refuse(_record):
        raise NonSimulatorFrameError("not a simulator")

    with pytest.raises(NonSimulatorFrameError):
        measure_one_stack(a_stack(staging), x=0.0, y=0.0, centre=0.0, score=_score,
                          output=prepare_acquisition(run, "focussing"), keep=refuse)


def test_recorded_settings_are_wrapped_as_the_driver_reads_them():
    assert as_state({"job": "Focussing"}) == {"changeable": {"job": "Focussing"}}
    whole = {"changeable": {"job": "Focussing"}, "observed": {}}
    assert as_state(whole) is whole
