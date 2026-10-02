"""Synthetic pixels are allowed only for captures that LAS X itself calls a simulator."""

from __future__ import annotations

import pytest

from zmart_interface.parts.microscope.simulator_guard import (
    NonSimulatorFrameError,
    assert_simulator,
    system_type_of,
)


def _xlif(folder, name, system_type):
    path = folder / name
    attribute = f' SystemTypeName="{system_type}"' if system_type is not None else ""
    path.write_text(
        f'<LMSDataContainerHeader><Element><Attachment Name="HardwareSetting"{attribute}/>'
        "</Element></LMSDataContainerHeader>",
        encoding="utf-8",
    )
    return path


def test_a_simulator_capture_is_accepted(tmp_path):
    paths = [_xlif(tmp_path, "a.xlif", "SIMULATOR"), _xlif(tmp_path, "b.xlif", "SIMULATOR")]
    assert system_type_of(paths) == "SIMULATOR"
    assert_simulator(paths, "P0")


@pytest.mark.parametrize("system_type", ["STELLARIS 5", "", None])
def test_anything_else_is_refused(tmp_path, system_type):
    paths = [_xlif(tmp_path, "a.xlif", system_type)]
    with pytest.raises(NonSimulatorFrameError, match="not 'SIMULATOR'"):
        assert_simulator(paths, "P0")


def test_no_files_and_unreadable_files_are_refused(tmp_path):
    with pytest.raises(NonSimulatorFrameError):
        assert_simulator([], "P0")
    broken = tmp_path / "broken.xlif"
    broken.write_text("<not closed", encoding="utf-8")
    with pytest.raises(NonSimulatorFrameError):
        assert_simulator([broken, tmp_path / "missing.xlif"], "P0")


def test_two_files_that_disagree_are_refused(tmp_path):
    paths = [_xlif(tmp_path, "a.xlif", "SIMULATOR"), _xlif(tmp_path, "b.xlif", "STELLARIS 5")]
    assert system_type_of(paths) is None
    with pytest.raises(NonSimulatorFrameError):
        assert_simulator(paths, "P0")
