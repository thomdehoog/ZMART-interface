"""The interface's bridge: the general bridge, with what this interface offers beside it.

The bridge's general part (``framework/bridge``) knows no instrument: it
offers what the controller lists, and keeps the pixels a microscope
captures. This is how the interface starts it, both from the window
(``launcher.py``) and on its own for a browser::

    python -m zmart_interface.serving --port 8600

and what it adds:

- **the interface's own mock microscope, first** in the list, so a page
  opened by accident drives nothing real, plugged in directly whether or
  not it is installed with the controller, and with its own small window
  opened beside the session, as a vendor's software would be there;
- **the LAS X simulator's synthetic specimen**, with ``--simulator-pixels``
  only: a tilted kidney section that stands in for the simulator's
  pixels, so a run on the simulator has something real to focus on and
  detect. It refuses, and stops the run, on any frame that does not
  identify itself as the simulator's.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import argparse
import sys

from zmart_interface import mock_microscope
from zmart_interface.framework.bridge import server


def offered() -> dict[str, tuple[object, dict]]:
    """The microscopes the interface offers before the controller's list: its mock, with its window."""
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


def add_arguments(parser: argparse.ArgumentParser) -> None:
    """The bridge's own choices, and the interface's: shared with the window's launcher."""
    server.add_arguments(parser)
    parser.add_argument("--simulator-pixels", action="store_true",
                        help="synthetic pixels, only for captures identified as LAS X SIMULATOR")


def serve(port: int = 8600, output_root: str | None = None, *, simulator_pixels: bool = False):
    """Start the interface's bridge in a background thread and hand back its server."""
    return server.serve(
        port, output_root, offered=offered(), pixels_for=pixels_for(simulator_pixels=simulator_pixels),
    )


def main(argv: list[str] | None = None) -> int:
    """Run the interface's bridge on its own, serving the built page and the instruments."""
    parser = argparse.ArgumentParser(
        description="The interface's bridge: the operator page's backend, with the interface's mock microscope",
    )
    parser.add_argument("--port", type=int, default=8600)
    parser.add_argument("--workflows", action="store_true",
                        help="list the workflows installed on this computer, and stop")
    add_arguments(parser)
    args = parser.parse_args(argv)
    if args.workflows:
        print(server.installed_workflows_report())
        return 0
    bridge = server.a_bridge_on(
        args.port, args.output_root,
        offered=offered(), pixels_for=pixels_for(simulator_pixels=args.simulator_pixels),
    )
    print(f"bridge listening on 127.0.0.1:{args.port}")
    bridge.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
