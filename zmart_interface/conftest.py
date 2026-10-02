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

from zmart_interface import mock_microscope
from zmart_interface.parts.microscope.instrument import Instrument


@pytest.fixture(autouse=True)
def _a_machine_of_its_own(tmp_path, monkeypatch):
    """Keep the controller's configuration folder and the mock's settings in the test's folder.

    And no mock instrument window: connecting to the mock opens one beside
    the session, which a test has no screen for.
    """
    monkeypatch.setenv("ZMART_MICROSCOPY_ROOT", str(tmp_path / "machine"))
    monkeypatch.setenv("ZMART_MOCK_STATE", str(tmp_path / "mock" / "instrument.json"))
    monkeypatch.setattr(mock_microscope, "open_the_window", lambda connection: None)


@pytest.fixture
def mock_instrument(tmp_path) -> dict:
    """The mock's entry in the controller's list, saving its images in this test's folder."""
    mock_microscope.register()
    instrument = next(
        one for one in zmart_controller.get_instruments() if one["vendor"] == mock_microscope.VENDOR
    )
    return {**instrument, "output_root": str(tmp_path / "images")}


@pytest.fixture
def mock_session(mock_instrument):
    """A connected mock microscope, read the way the bridge reads it: answers are reports."""
    session = Instrument(zmart_controller.session.set_instrument(mock_instrument))
    try:
        yield session
    finally:
        session.disconnect()
