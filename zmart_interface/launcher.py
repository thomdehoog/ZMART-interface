"""The ZMART interface: the operator page in a window of its own.

This is how the page is meant to be met -- a native window, not a browser tab
with its chrome, its zoom and its address bar. It starts the bridge (the part
that talks to the microscope through the ZMART Controller), opens the window,
and points one at the other::

    zmart-interface                 # the built page, as the microscope runs it
    zmart-interface --dev           # the development server's page, edits reload live

By default the bridge serves the page and the instrument on one address, which
is exactly how it runs on the microscope PC. The page comes with the package,
already built, so nothing has to be built on the microscope.

``--dev`` is for working on the page itself: the Vite development server
(``npm run dev``, in a checkout of this repository) holds the page so edits
appear as they are saved, and the page is told where the bridge is.

Why the page is served rather than opened from the disk
-------------------------------------------------------

One of the drawing engines is neuroglancer, which does part of its work in
background programs, and a browser refuses to start one for a page opened off
the disk, because such a page has no address of its own. So the page is
served over HTTP, by the bridge, which is already here.

The window is drawn by pywebview, which on Windows uses the WebView2 runtime.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import argparse
import sys
import urllib.error
import urllib.request
from pathlib import Path

#: What ``npm run build`` leaves, and the package carries: the page and
#: neuroglancer's two background programs beside it. The bridge hands them out.
BUILT = Path(__file__).resolve().parent / "framework" / "window" / "build" / "index.html"

#: Where ``npm run dev`` serves the page while it is being worked on.
DEV_URL = "http://127.0.0.1:5174/"


def _dev_server_is_up(url: str, timeout: float = 1.5) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout):
            return True
    except (urllib.error.URLError, OSError):
        return False


def main(argv: list[str] | None = None) -> int:
    from zmart_interface.framework import bridge

    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--dev", nargs="?", const=DEV_URL, default=None, metavar="URL",
        help=f"open the development server's page instead of the built one (default {DEV_URL})",
    )
    bridge.add_arguments(parser)
    args = parser.parse_args(argv)

    if args.dev and not _dev_server_is_up(args.dev):
        print(f"nothing answering at {args.dev} — start it with `npm run dev`, or leave out --dev")
        return 1
    if not args.dev and not BUILT.exists():
        print(f"no built page at {BUILT} — run `npm run build` in the repository first")
        return 1

    try:
        import webview
    except ModuleNotFoundError:
        print("this needs the 'pywebview' package; or run "
              "`python -m zmart_interface.framework.bridge` and open its address in a browser")
        return 1

    server = bridge.serve(0, args.output_root, simulator_pixels=args.simulator_pixels)
    bridge_at = f"http://127.0.0.1:{server.server_address[1]}"
    if args.dev:
        # The development server holds the page so edits reload live, which
        # puts it on another address from the bridge -- so the page is told.
        target = f"{args.dev}{'&' if '?' in args.dev else '?'}bridge={bridge_at}"
        note = f"development page · {args.dev} · bridge at {bridge_at}"
    else:
        target, note = bridge_at, f"built page · served with the bridge at {bridge_at}"

    print(f"opening the {note}")
    title = "ZMART — LAS X SIMULATOR / SYNTHETIC PIXELS" if args.simulator_pixels else "ZMART"
    webview.create_window(title, target, width=1500, height=950)
    webview.start()
    return 0


if __name__ == "__main__":
    sys.exit(main())
