"""Synthetic pixels only on the LAS X simulator: the check that keeps them off real data.

Started with ``--simulator-pixels``, the interface keeps a run captured on the
Leica LAS X *simulator* with realistic synthetic pixels (a kidney section,
blurred by how far the focus is from it; see ``simulator_pixels.py``) in
place of the simulator's own empty frames, so focus maps and detection can be
rehearsed on something that looks like tissue. That must never happen to a
picture taken on a real microscope.

So every capture is checked first. The Leica driver copies LAS X's own
description of each capture (an ``.xlif`` file) beside the images, and that
file names the system it came from in a ``SystemTypeName`` attribute. Only
when every file the driver returned says exactly ``SIMULATOR`` -- one value,
no other -- may the synthetic pixels be used. A missing file, an unreadable
one, a different name, or two files that disagree all fail closed with
:class:`NonSimulatorFrameError`, which stops the run rather than being filed
as one failed field.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path


class NonSimulatorFrameError(RuntimeError):
    """The capture does not identify itself as coming from the LAS X simulator.

    Raised instead of putting synthetic pixels into it. Callers re-raise it
    ahead of any broad error handling, so the run stops: a real microscope's
    frame must never be quietly filed as one failed field and the run carried
    on.
    """


def system_type_of(paths) -> str | None:
    """The one ``SystemTypeName`` the vendor files name, or ``None``.

    ``None`` when no file names one, when a file cannot be read, or when two
    files name different systems: anything but one clear answer.
    """
    values: set[str] = set()
    for path in sorted(map(Path, paths)):
        try:
            root = ET.parse(path).getroot()
        except (OSError, ET.ParseError):
            continue
        for element in root.iter():
            value = element.get("SystemTypeName")
            if value:
                values.add(value)
    return next(iter(values)) if len(values) == 1 else None


def assert_simulator(paths, display_name: str) -> None:
    """Raise :class:`NonSimulatorFrameError` unless the vendor files say ``SIMULATOR``."""
    system_type = system_type_of(paths)
    if system_type != "SIMULATOR":
        raise NonSimulatorFrameError(
            f"refusing to use synthetic pixels for {display_name}: LAS X's own description "
            f"of the capture names the system {system_type!r}, not 'SIMULATOR'"
        )
