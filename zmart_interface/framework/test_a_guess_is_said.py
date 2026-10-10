"""A pixel size or frame size the microscope did not report is said to be a guess.

From the review of 10 October, finding 8: a driver may report its pixel size
as nothing (the Leica does when a job's geometry cannot be read). The bridge
then used 1 µm per pixel, and a 512-pixel frame when the format was missing
too, and nothing on the page told those numbers from measured ones. Now the
reading's summary, which is the line the operator reads, says what was
guessed, and target discovery refuses to measure objects in a pixel size
nobody reported.

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


def test_a_measured_reading_says_nothing_was_guessed(monkeypatch):
    said = read({"pixel_size": {"x": 0.5}, "format": "1024 x 1024"}, monkeypatch)
    assert said["guessed"] == []
    assert "guess" not in said["summary"]
    assert said["frameUm"] == 512


def test_a_missing_pixel_size_is_said_to_be_guessed(monkeypatch):
    said = read({"pixel_size": None, "format": "1024 x 1024"}, monkeypatch)
    assert said["guessed"] == ["pixel size", "frame size"]
    assert said["summary"].endswith(
        "guessed: the microscope did not report its pixel size and frame size")


def test_a_missing_format_alone_guesses_only_the_frame(monkeypatch):
    said = read({"pixel_size": {"x": 1.0}}, monkeypatch)
    assert said["guessed"] == ["frame size"]
    assert said["frameUm"] == readings.A_GUESSED_FORMAT_PX


def test_a_measured_frame_is_not_a_guess_even_without_a_pixel_size(monkeypatch):
    said = read({"pixel_size": None, "frame_size": {"x": 676.4, "unit": "um"}}, monkeypatch)
    assert said["guessed"] == ["pixel size"]
    assert said["frameUm"] == 676


def test_targets_are_not_measured_in_a_pixel_size_nobody_reported(monkeypatch):
    monkeypatch.setattr(state, "session", Instrument(Reporting({"pixel_size": None})))
    with pytest.raises(RuntimeError, match="does not report its pixel size"):
        discovery.find_targets()
