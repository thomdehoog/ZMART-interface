"""The pixel size and the frame size come from the microscope, or the reading is refused.

From the review of 10 October, finding 8. A driver may report its pixel size
as nothing (the Leica does when a job's geometry cannot be read). The bridge
then used 1 µm per pixel, and a 512-pixel frame when the format was missing
too. A plan laid on those numbers has gaps or overlaps, and objects are
measured at the wrong size, so a guess is never made: the reading is refused
with a sentence that says what the microscope did not report, and target
discovery refuses to start.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import pytest

from zmart_interface.framework.bridge import discovery, readings, state
from zmart_interface.parts.microscope.instrument import Instrument


class Reporting:
    """A microscope whose state reports exactly the ``observed`` it is given."""

    def __init__(self, observed):
        self.context = {"driver": "stub"}
        self.observed = observed

    def get_state(self):
        return {"success": True, "content": {"changeable": {}, "observed": self.observed}}


def read(observed, monkeypatch):
    monkeypatch.setattr(state, "session", Instrument(Reporting(observed)))
    return readings.reading("acquisition")


def test_a_reading_with_both_sizes_reported_is_taken(monkeypatch):
    said = read({"pixel_size": {"x": 0.5}, "format": "1024 x 1024"}, monkeypatch)
    assert said["frameUm"] == 512
    assert said["summary"].endswith("512 × 512 µm")


@pytest.mark.parametrize("pixel", [None, {}, {"x": None}, {"x": 0}])
def test_a_reading_without_a_pixel_size_is_refused(monkeypatch, pixel):
    with pytest.raises(RuntimeError, match="did not report its pixel size"):
        read({"pixel_size": pixel, "format": "1024 x 1024"}, monkeypatch)


def test_a_measured_field_of_view_still_needs_the_pixel_size(monkeypatch):
    with pytest.raises(RuntimeError, match="did not report its pixel size"):
        read({"pixel_size": None, "frame_size": {"x": 676.4, "unit": "um"}}, monkeypatch)


def test_a_reading_without_a_format_or_field_of_view_is_refused(monkeypatch):
    with pytest.raises(RuntimeError, match="how many pixels"):
        read({"pixel_size": {"x": 1.0}}, monkeypatch)


def test_nothing_in_the_bridge_is_a_guessed_size_any_more():
    assert not hasattr(readings, "A_GUESSED_FORMAT_PX")
    assert not hasattr(readings, "A_GUESSED_PIXEL_UM")


def test_targets_are_not_measured_in_a_pixel_size_nobody_reported(monkeypatch):
    monkeypatch.setattr(state, "session", Instrument(Reporting({"pixel_size": None})))
    with pytest.raises(RuntimeError, match="did not report its pixel size"):
        discovery.find_targets()
