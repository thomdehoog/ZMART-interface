"""How target acquisition takes part in starting and closing the interface.

The bridge knows no instrument. Target acquisition offers its own mock
microscope first, so a page opened by accident drives nothing real, with the
mock's small window opened beside the session as a vendor's software would
be; and, with ``--simulator-pixels`` only, the LAS X simulator's synthetic
specimen, a tilted kidney section that stands in for the simulator's pixels so
a run on the simulator has something real to focus on and detect. It refuses,
and stops the run, on any frame that does not identify itself as the
simulator's. Closing the window stops a running scan between two fields and
closes the session.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

from zmart_interface import mock_microscope
from zmart_interface.framework.bridge import connecting, state


def offered() -> dict[str, tuple[object, dict]]:
    """The microscopes offered before the controller's list: the mock, with its window."""
    return {mock_microscope.NAME: (mock_microscope, {**mock_microscope.CONNECTION, "open_window": True})}


def pixels_for(*, simulator_pixels: bool):
    """How to make the simulator's stand-in pixels for a session, or None to keep the captured ones.

    The specimen is anchored at the height the stage stands at when the
    session opens (``z_um``), and that anchor is written into its recipe, so
    the run says how its pixels were made.
    """
    if not simulator_pixels:
        return None

    def a_synthetic_specimen(z_um: float):
        from zmart_interface.parts.microscope.simulator_pixels import KidneyPixels  # noqa: PLC0415

        specimen = KidneyPixels(focus_z_um=z_um)
        specimen.recipe["focus_reference"] = "session-connect"
        return specimen

    return a_synthetic_specimen


def add_arguments(group) -> None:
    """``--simulator-pixels``."""
    group.add_argument("--simulator-pixels", action="store_true",
                       help="synthetic pixels, only for captures identified as LAS X SIMULATOR")


def start(args) -> str | None:
    """Offer the mock, and the simulator's pixels when asked; name the window when they are."""
    simulator_pixels = bool(getattr(args, "simulator_pixels", False))
    connecting.offered = offered()
    state.pixels_for = pixels_for(simulator_pixels=simulator_pixels)
    return "ZMART — LAS X SIMULATOR / SYNTHETIC PIXELS" if simulator_pixels else None


def close(wait_s: float) -> None:
    """Stop a running scan between two fields, then close the session."""
    connecting.let_the_last_session_go(wait_s=wait_s)
    connecting.disconnect()
