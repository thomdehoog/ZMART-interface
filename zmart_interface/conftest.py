"""What the Python tests share: a machine of their own, and the mock microscope.

The tests stand beside what they test -- a part's tests in the part -- so
this file hangs on the package, the one thing they all belong to.

Every test gets its own computer configuration folder and its own mock
settings file, so nothing a test does reaches the real ``C:\\ProgramData``
folder or the user's home, and no test sees what an earlier one chose.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import pytest
import zmart_controller
import zmart_controller.session
import zmart_controller.utils

from zmart_interface import mock_microscope
from zmart_interface.parts.microscope.instrument import Instrument


@pytest.fixture(autouse=True)
def _a_machine_of_its_own(tmp_path, monkeypatch):
    """Keep the controller's configuration, its list of drivers and the mock's settings in the test's folder.

    And no mock instrument window: connecting to the mock opens one beside
    the session, which a test has no screen for.
    """
    monkeypatch.setenv("ZMART_MICROSCOPY_ROOT", str(tmp_path / "machine"))
    monkeypatch.setenv("ZMART_MOCK_STATE", str(tmp_path / "mock" / "instrument.json"))
    # The controller keeps its list of registered drivers in the machine's
    # folder above, or in the home folder when that cannot be written; a test
    # gets its own of both.
    monkeypatch.setattr(zmart_controller.utils, "user_root", lambda: tmp_path / "home")
    monkeypatch.setattr(mock_microscope, "open_the_window", lambda connection: None)


@pytest.fixture
def mock_instrument(tmp_path) -> dict:
    """The connection the mock is plugged in with, saving its images in this test's folder.

    Hand it to the controller with the mock's module:
    ``set_instrument(mock_microscope, mock_instrument)``.
    """
    return {"client": "mock-client", "output_root": str(tmp_path / "images")}


@pytest.fixture
def mock_session(mock_instrument):
    """A connected mock microscope, read the way the bridge reads it: each answer is its content."""
    session = Instrument(zmart_controller.session.set_instrument(mock_microscope, mock_instrument))
    try:
        yield session
    finally:
        session.disconnect()
