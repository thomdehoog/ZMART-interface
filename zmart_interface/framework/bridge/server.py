"""The HTTP shell: routes in, JSON out, errors as sentences.

Every route is one of the page's backend verbs, dispatched to the module
that does the work. The server also hands out the built page and the
pictures a run makes, so the microscope computer runs one program on one
address.

Standard library only, on purpose. The microscope computer has no network
to install packages from, and this server is a handful of routes: a
framework would save thirty lines and cost a dependency forever.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import argparse
import json
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from zmart_interface.parts.microscope.focus_run import FOCUSSING
from zmart_interface.parts.microscope.instrument import InstrumentDeclined
from zmart_interface.parts.storage import viewer_service

from . import (
    connecting,
    discovery,
    focus,
    pictures,
    plots,
    protocols,
    readings,
    scan,
    stage,
    state,
    targets,
)

#: Where ``npm run build`` leaves the page, beside the window that shows it.
THE_PAGE = Path(__file__).resolve().parent.parent / "window" / "build"


class Bridge(BaseHTTPRequestHandler):
    # Keep the connection: HTTP/1.0 opened a fresh TCP connection per
    # picture, which is 34 measured milliseconds a tile and seventy seconds
    # for a 2061-field overview. Every response carries its Content-Length,
    # which is what keep-alive requires.
    protocol_version = "HTTP/1.1"

    def _answer(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, default=str).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # The page may be served by the dev server on another port while this
        # is being developed; on the microscope one server serves both and
        # this header is redundant but harmless.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _fail(self, why: Exception) -> None:
        """A failure as the sentence the page shows.

        A microscope that answered "I could not" is not a broken bridge, so it
        is told apart as 409: whoever reads the log sees the instrument's own
        refusal rather than an internal error. The page shows the sentence
        either way, where the press was made.
        """
        if isinstance(why, InstrumentDeclined):
            kind = 409
        elif isinstance(why, (ValueError, KeyError)):
            kind = 400
        else:
            kind = 500
        self._answer({"error": str(why)}, status=kind)

    #: What the built page is made of, and what to call each piece when sent.
    #: A browser will not start a background program from a file it was told is
    #: anything but JavaScript, and it says nothing when it refuses -- the
    #: picture simply never appears.
    PAGE = {
        ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
        ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm",
        ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2",
    }

    def _send_the_page(self, path: str) -> None:
        """Hand out the built operator page, so one process serves the whole thing.

        The microscope PC gets one program: the page it draws and the
        instrument it drives, on one address. That is also why the page finds
        the bridge at its own origin and needs telling only in development,
        where a dev server holds the page instead so that edits reload live.
        """
        name = path.lstrip("/") or "index.html"
        where = (THE_PAGE / name).resolve()
        wanted = self.PAGE.get(where.suffix)
        if THE_PAGE not in where.parents or wanted is None or not where.is_file():
            self._answer({"error": f"no page at {path}"}, status=404)
            return
        body = where.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", wanted)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    #: What a view folder is allowed to hold, and what to call it when sent.
    #: A short list rather than a guess, because this hands out files by a name
    #: the page chose: anything not on it is not a picture and is not sent.
    PICTURES = {".jpg": "image/jpeg", ".png": "image/png", "tiles.json": "application/json"}

    def _send_a_picture(self, path: str, query: str = "") -> None:
        """Hand out one file from a scan's view folder.

        ``/view/<acquisition type>/<name>``. Browsers will not let a page read
        files off a disk, so the pictures a scan makes have to be served, and
        this is the only reason the bridge serves anything that is not JSON.

        The name is taken apart rather than joined on: a name with a path in it
        would otherwise reach out of the folder and hand out any file this
        process can read.
        """
        _, _, rest = path.partition("/view/")
        kind, _, name = rest.partition("/")
        wanted = self.PICTURES.get(name if name in self.PICTURES else Path(name).suffix)
        if not kind or not name or name != Path(name).name or wanted is None:
            self._answer({"error": f"no picture {rest!r}"}, status=404)
            return
        display = pictures.the_display_asked_for(query)
        if display is not None and name.endswith(".jpg") and kind != FOCUSSING:
            # The copy drawn with the picture's own display settings: what
            # the page's canvas shows, not the scan-wide stretch the small
            # copies wear. Rendered on request and remembered by its asking.
            body = pictures.a_picture_as_displayed(kind, name[: -len(".jpg")], display)
            if body is None:
                self._answer({"error": f"nothing has been imaged at {rest}"}, status=404)
                return
            self._send_bytes(body, wanted)
            return
        if name.endswith(".mask.png"):
            # A field's detection mask, colorized on first request: the page
            # asks by the field's label, and a field detection has not
            # visited answers 404 rather than a broken picture.
            where = pictures.the_mask_view_for(kind, name[: -len(".mask.png")])
        elif name.endswith(".labels.png"):
            # The raw labels, losslessly: what lets the page light one
            # object's true shape rather than a blob where it stands.
            where = pictures.the_label_map_for(kind, name[: -len(".labels.png")])
        elif kind == FOCUSSING:
            # A focus stack's slices: written as each point lands, no note --
            # the point itself tells the page their names and heights.
            where = pictures.view_of(kind) / name
        else:
            note = pictures.the_view_of(kind)
            where = None if note is None else (note if name == "tiles.json" else note.parent / name)
        if where is None or not where.is_file():
            self._answer({"error": f"nothing has been imaged at {rest}"}, status=404)
            return
        self._send_bytes(where.read_bytes(), wanted)

    def _send_bytes(self, body: bytes, content_type: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        # A scan's note and its pictures change as it runs, so nothing here is
        # worth keeping: a cached note is a canvas that stops growing.
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length) or b"{}")

    def do_OPTIONS(self) -> None:  # noqa: N802 — http.server's naming
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802 — http.server's naming
        path, _, query = self.path.partition("?")
        try:
            if path == "/api/setting":
                kind = dict(pair.split("=") for pair in query.split("&") if pair).get(
                    "type", "acquisition"
                )
                with state.the_instruments_turn:
                    self._answer(readings.reading(kind))
            elif path == "/api/instruments":
                self._answer({"instruments": connecting.instruments()})
            elif path == "/api/info":
                # The driver's account of the session: its connection checks
                # (polled while they answer).
                with state.the_instruments_turn:
                    self._answer(state.require_session().get_info())
            elif path == "/api/xyz":
                self._answer(stage.where_the_stage_is())
            elif path == "/api/acquisition_settings":
                with state.the_instruments_turn:
                    self._answer(readings.acquisition_settings())
            elif path == "/api/scan":
                since = urllib.parse.parse_qs(query or "").get("since", [None])[0]
                self._answer(scan.the_scan(int(since) if since is not None else None))
            elif path == "/api/focus/measure":
                self._answer(dict(state.focus))
            elif path == "/api/targets/discover":
                since = urllib.parse.parse_qs(query or "").get("since", [None])[0]
                self._answer(discovery.the_targets(int(since) if since is not None else None))
            elif path == "/api/plots/compute":
                self._answer(dict(state.plots))
            elif path == "/api/protocols":
                self._answer(protocols.protocols())
            elif path == "/api/plots/columns":
                kind = urllib.parse.parse_qs(query or "").get("kind", [""])[0]
                self._answer(plots.plot_columns(kind))
            elif path == "/api/targets/acquire":
                since = urllib.parse.parse_qs(query or "").get("since", [None])[0]
                self._answer(targets.the_target_run(int(since) if since is not None else None))
            elif path == "/api/viewer":
                status = viewer_service.status()
                self._answer(status)
            elif path.startswith("/view/"):
                self._send_a_picture(path, query)
            elif not path.startswith("/api/"):
                self._send_the_page(path)
            else:
                self._answer({"error": f"no route {path}"}, status=404)
        except Exception as why:  # noqa: BLE001
            self._fail(why)

    def do_POST(self) -> None:  # noqa: N802 — http.server's naming
        try:
            asked = self._body()
            if self.path == "/api/connect":
                with state.the_instruments_turn:
                    self._answer(connecting.connect(asked))
            elif self.path == "/api/disconnect":
                with state.the_instruments_turn:
                    self._answer(connecting.disconnect())
            elif self.path == "/api/xyz":
                with state.the_instruments_turn:
                    self._answer(stage.drive_to(asked))
            elif self.path == "/api/state":
                with state.the_instruments_turn:
                    self._answer(readings.apply_state(asked))
            elif self.path == "/api/acquire":
                with state.the_instruments_turn:
                    self._answer(readings.capture(asked))
            elif self.path == "/api/focus/begin":
                self._answer(focus.begin_focus(asked))
            elif self.path == "/api/focus/score":
                self._answer(focus.score_focus(asked))
            elif self.path == "/api/focus/end":
                self._answer(focus.end_focus(asked))
            elif self.path == "/api/plots/compute":
                self._answer(plots.compute_plot(asked))
            elif self.path == "/api/plots/compute/stop":
                self._answer(plots.stop_plot())
            elif self.path == "/api/protocol":
                self._answer(protocols.save_protocol(asked))
            elif self.path == "/api/protocol/save":
                self._answer(protocols.save_protocol_to_library(asked))
            elif self.path == "/api/protocols":
                # Before connecting: what the chosen microscope's saved
                # connection can say about the root.
                chosen = asked.get("instrument")
                self._answer(protocols.protocols(connecting.saved_connection(chosen) if chosen else None))
            elif self.path == "/api/targets/acquire/begin":
                self._answer(targets.begin_target_run(asked))
            elif self.path == "/api/targets/acquire/focus":
                self._answer(targets.score_target_focus(asked))
            elif self.path == "/api/targets/acquire/landed":
                self._answer(targets.target_landed(asked))
            elif self.path == "/api/targets/acquire/end":
                self._answer(targets.end_target_run(asked))
            elif self.path == "/api/targets/discover/stop":
                self._answer(discovery.stop_targets())
            elif self.path == "/api/scan":
                self._answer(scan.start_scan(asked))
            elif self.path == "/api/scan/stop":
                self._answer(scan.stop_scan())
            elif self.path == "/api/targets/discover":
                self._answer(discovery.discover_targets(asked))
            elif self.path == "/api/targets/raise":
                self._answer(targets.raise_target(asked))
            else:
                self._answer({"error": f"no route {self.path}"}, status=404)
        except Exception as why:  # noqa: BLE001
            self._fail(why)

    def log_message(self, *_args) -> None:
        """Quiet: the terminal is the operator's too."""


def a_bridge_on(
    port: int, output_root: str | None = None, *, simulator_pixels=False,
) -> ThreadingHTTPServer:
    """A bridge ready to answer, with every driver this machine has.

    Both ways in -- run on its own, or started by the window -- build it
    here, so both offer the same list of microscopes.
    """

    state.simulator_pixels_enabled = bool(simulator_pixels)
    state.pixel_provider = None
    state.output_root = output_root
    return ThreadingHTTPServer(("127.0.0.1", port), Bridge)


def serve(
    port: int = 8600, output_root: str | None = None, *, simulator_pixels=False,
) -> ThreadingHTTPServer:
    """Start a bridge in a background thread and hand back its server."""
    server = a_bridge_on(port, output_root, simulator_pixels=simulator_pixels)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def add_arguments(parser: argparse.ArgumentParser) -> None:
    """The choices the bridge takes, shared with the window's launcher."""
    parser.add_argument("--simulator-pixels", action="store_true",
                        help="synthetic pixels, only for captures identified as LAS X SIMULATOR")
    parser.add_argument("--output-root",
                        help="where runs go, for a driver that cannot discover its own")


def main(argv: list[str] | None = None) -> int:
    """Run the bridge on its own, serving the built page and the instrument."""
    parser = argparse.ArgumentParser(
        description="The bridge: the operator page's backend, serving the page and the instrument",
    )
    parser.add_argument("--port", type=int, default=8600)
    add_arguments(parser)
    args = parser.parse_args(argv)
    server = a_bridge_on(args.port, args.output_root, simulator_pixels=args.simulator_pixels)
    print(f"bridge listening on 127.0.0.1:{args.port}")
    server.serve_forever()
    return 0
