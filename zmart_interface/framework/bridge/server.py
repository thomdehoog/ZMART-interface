"""The HTTP shell: routes in, JSON out, errors as sentences.

Every route is one of the page's backend verbs, dispatched to the module
that does the work. The server also hands out the built page, the pictures
a run makes and the files of the workflows installed on this computer, so
the microscope computer runs one program on one address.

Standard library only, on purpose. The microscope computer has no network
to install packages from, and this server is a handful of routes: a
framework would save thirty lines and cost a dependency forever.

The routes are a table, ``ROUTES``, from ``(method, path)`` to the function
that answers it. A function is put there with the :func:`route` decorator
below, takes ``(asked, query)`` -- the request's JSON body as a dictionary
(empty for a GET) and the raw query string -- and answers the dictionary the
page receives; an exception it raises becomes the sentence the page shows,
with the status :meth:`Bridge._fail` gives it. An installed workflow's
Python half adds its own routes to the same table through
:func:`add_route`, under ``/api/<its folder>/``.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from zmart_interface.parts.microscope.focus_run import FOCUSSING
from zmart_interface.parts.microscope.instrument import InstrumentDeclined
from zmart_interface.parts.storage import viewer_service

from .. import workflow_library
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
    workflows,
)

#: Where ``npm run build`` leaves the page, beside the window that shows it.
THE_PAGE = Path(__file__).resolve().parent.parent / "window" / "build"

#: The routes, by method and path: what answers ``GET /api/instruments`` is
#: ``ROUTES[("GET", "/api/instruments")]``.
ROUTES: dict[tuple[str, str], object] = {}


def add_route(method: str, path: str, handler) -> None:
    """Put a route in the table: ``handler(asked, query)`` answers ``method path``.

    Adding a route again replaces the earlier one, which is what an installed
    workflow's Python half needs when the bridge is built twice in one
    process, as the tests do.
    """
    ROUTES[(method.upper(), path)] = handler


def route(method: str, path: str):
    """Mark a function as the answer to ``method path``: ``@route("GET", "/api/xyz")``."""

    def put(handler):
        add_route(method, path, handler)
        return handler

    return put


# --- the routes, in the order the page meets them ------------------------------


def _since(query: str) -> int | None:
    """The ``since=N`` a ledger is read from, when the page has part of it already."""
    since = urllib.parse.parse_qs(query or "").get("since", [None])[0]
    return int(since) if since is not None else None


@route("GET", "/api/instruments")
def _instruments(asked, query):
    return {"instruments": connecting.instruments()}


@route("POST", "/api/connect")
def _connect(asked, query):
    # Outside the instrument's turn: a running scan needs it to finish its field.
    connecting.let_the_last_session_go()
    with state.the_instruments_turn:
        return connecting.connect(asked)


@route("POST", "/api/disconnect")
def _disconnect(asked, query):
    with state.the_instruments_turn:
        return connecting.disconnect()


@route("GET", "/api/info")
def _info(asked, query):
    # The driver's account of the session: its connection checks (polled
    # while they answer).
    with state.the_instruments_turn:
        return state.require_session().get_info()


@route("GET", "/api/setting")
def _setting(asked, query):
    kind = urllib.parse.parse_qs(query or "").get("type", ["acquisition"])[0]
    with state.the_instruments_turn:
        return readings.reading(kind)


@route("GET", "/api/xyz")
def _where_the_stage_is(asked, query):
    return stage.where_the_stage_is()


@route("POST", "/api/xyz")
def _drive_to(asked, query):
    with state.the_instruments_turn:
        return stage.drive_to(asked)


@route("GET", "/api/acquisition_settings")
def _acquisition_settings(asked, query):
    with state.the_instruments_turn:
        return readings.acquisition_settings()


@route("POST", "/api/state")
def _apply_state(asked, query):
    with state.the_instruments_turn:
        return readings.apply_state(asked)


@route("POST", "/api/acquire")
def _capture(asked, query):
    with state.the_instruments_turn:
        return readings.capture(asked)


@route("POST", "/api/focus/begin")
def _begin_focus(asked, query):
    return focus.begin_focus(asked)


@route("POST", "/api/focus/score")
def _score_focus(asked, query):
    return focus.score_focus(asked)


@route("POST", "/api/focus/end")
def _end_focus(asked, query):
    return focus.end_focus(asked)


@route("GET", "/api/focus/measure")
def _focus_ledger(asked, query):
    return dict(state.focus)


@route("POST", "/api/scan")
def _start_scan(asked, query):
    return scan.start_scan(asked)


@route("GET", "/api/scan")
def _the_scan(asked, query):
    return scan.the_scan(_since(query))


@route("POST", "/api/scan/stop")
def _stop_scan(asked, query):
    return scan.stop_scan()


@route("POST", "/api/targets/discover")
def _discover_targets(asked, query):
    return discovery.discover_targets(asked)


@route("GET", "/api/targets/discover")
def _the_targets(asked, query):
    return discovery.the_targets(_since(query))


@route("POST", "/api/targets/discover/stop")
def _stop_targets(asked, query):
    return discovery.stop_targets()


@route("POST", "/api/plots/compute")
def _compute_plot(asked, query):
    return plots.compute_plot(asked)


@route("GET", "/api/plots/compute")
def _plots_ledger(asked, query):
    return dict(state.plots)


@route("POST", "/api/plots/compute/stop")
def _stop_plot(asked, query):
    return plots.stop_plot()


@route("GET", "/api/plots/columns")
def _plot_columns(asked, query):
    kind = urllib.parse.parse_qs(query or "").get("kind", [""])[0]
    return plots.plot_columns(kind)


@route("POST", "/api/targets/acquire/begin")
def _begin_target_run(asked, query):
    return targets.begin_target_run(asked)


@route("POST", "/api/targets/acquire/focus")
def _score_target_focus(asked, query):
    return targets.score_target_focus(asked)


@route("POST", "/api/targets/acquire/landed")
def _target_landed(asked, query):
    return targets.target_landed(asked)


@route("POST", "/api/targets/acquire/end")
def _end_target_run(asked, query):
    return targets.end_target_run(asked)


@route("GET", "/api/targets/acquire")
def _the_target_run(asked, query):
    return targets.the_target_run(_since(query))


@route("POST", "/api/targets/raise")
def _raise_target(asked, query):
    return targets.raise_target(asked)


@route("GET", "/api/protocols")
def _protocols(asked, query):
    return protocols.protocols()


@route("POST", "/api/protocols")
def _protocols_for(asked, query):
    # Before connecting: what the chosen microscope's saved connection can
    # say about the root.
    chosen = asked.get("instrument")
    return protocols.protocols(connecting.saved_connection(chosen) if chosen else None)


@route("POST", "/api/protocol")
def _save_protocol(asked, query):
    return protocols.save_protocol(asked)


@route("POST", "/api/protocol/save")
def _save_protocol_to_library(asked, query):
    return protocols.save_protocol_to_library(asked)


@route("GET", "/api/viewer")
def _viewer(asked, query):
    return viewer_service.status()


@route("GET", "/api/workflows")
def _installed_workflows(asked, query):
    # The packages installed on this computer, which the page loads as it
    # opens beside the workflows built into it.
    return workflows.listing()


#: The first part of every route the bridge itself answers (``targets`` for
#: ``/api/targets/discover``), taken before any workflow adds its own. A
#: workflow package in a folder of one of these names would replace the
#: bridge's own routes, so its Python half is refused at start-up.
THE_BRIDGES_OWN = frozenset(path.split("/")[2] for _method, path in ROUTES if path.startswith("/api/"))


#: The names this computer answers to. A request that arrives under any other
#: name was sent to a web address that someone pointed at 127.0.0.1, which is
#: how a page from elsewhere would try to look like one served here.
THIS_COMPUTER = {"127.0.0.1", "localhost", "::1"}


def on_this_computer(address: str) -> bool:
    """Whether ``address`` (``host:port`` or a page's origin) names this computer."""
    if "//" not in address:
        address = f"//{address}"
    try:
        return urllib.parse.urlsplit(address).hostname in THIS_COMPUTER
    except ValueError:
        return False


def refusal_for(headers) -> str | None:
    """Why a request must not be answered, or None when it comes from this computer.

    The bridge listens on 127.0.0.1, so other computers cannot reach it. A web
    page open in a browser on the microscope computer can, though, and a
    browser sends such a page's request without asking first when it is
    dressed as plain text. Three things the browser always says tell such a
    request apart: the name it was sent to (``Host``), the page it came from
    (``Origin``), and, for a plain read such as a picture, whether it crossed
    from another site (``Sec-Fetch-Site``). The operator page, served by the
    bridge or by the development server on another port, is on this computer
    by all three. A script run here (the tests, curl) sends no ``Origin`` and
    is let through.
    """
    host = headers.get("Host") or ""
    if not on_this_computer(host):
        return f"the bridge only answers requests addressed to this computer, not to {host!r}"
    origin = headers.get("Origin")
    if origin is not None and not on_this_computer(origin):
        return f"the bridge only answers pages served on this computer, not one from {origin!r}"
    if origin is None and headers.get("Sec-Fetch-Site") == "cross-site":
        return "the bridge only answers pages served on this computer, not one from another site"
    return None


class Bridge(BaseHTTPRequestHandler):
    # Keep the connection: HTTP/1.0 opened a fresh TCP connection per
    # picture, which is 34 measured milliseconds a tile and seventy seconds
    # for a 2061-field overview. Every response carries its Content-Length,
    # which is what keep-alive requires.
    protocol_version = "HTTP/1.1"

    def allow_the_page(self) -> None:
        """Let the page that asked read the answer, when it is on this computer.

        The development server holds the page on another port, and a browser
        hides an answer from a page on another port unless it is named here.
        Only the page that asked is named, never everyone (``*``): a page
        from elsewhere has been refused before anything is answered.
        """
        origin = self.headers.get("Origin")
        if origin is not None and on_this_computer(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def refused(self) -> bool:
        """Answer 403 to a request that does not come from this computer, and say so."""
        why = refusal_for(self.headers)
        if why is None:
            return False
        # The body is read and dropped first: a connection closed with a body
        # still unread is reset on Windows, and the refusal never arrives.
        length = int(self.headers.get("Content-Length") or 0)
        if 0 < length <= 1_000_000:
            self.rfile.read(length)
        self.close_connection = True
        self._answer({"error": why}, status=403)
        return True

    def _answer(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, default=str).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.allow_the_page()
        self.end_headers()
        self.wfile.write(body)

    def _fail(self, why: Exception) -> None:
        """A failure as the sentence the page shows.

        A microscope that answered "I could not" is not a broken bridge, so it
        is told apart as 409: whoever reads the log sees the instrument's own
        refusal rather than an internal error. The page shows the sentence
        either way, where the press was made.
        """
        said = str(why)
        if isinstance(why, InstrumentDeclined):
            kind = 409
        elif isinstance(why, KeyError):
            # Python says only the missing name, in quotes: "'record'".
            kind, said = 400, f"the request is missing {why.args[0]!r}" if why.args else said
        elif isinstance(why, (ValueError, TypeError)):
            kind = 400
        else:
            kind = 500
        self._answer({"error": said}, status=kind)

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

    def _send_a_package_file(self, path: str) -> None:
        """Hand out one file of an installed workflow's package.

        ``/workflows/<folder>/<file>``: the bundle the page loads, and whatever
        else a package holds that a page may ask for -- a stylesheet, a
        picture, a piece of markup. Which kinds, and how the name is kept
        inside the package, is :func:`workflow_library.package_file`'s
        business; anything it does not answer is 404.
        """
        _, _, rest = path.partition("/workflows/")
        folder, _, name = rest.partition("/")
        found = workflow_library.package_file(folder, name)
        if found is None:
            self._answer({"error": f"no workflow file at {path}"}, status=404)
            return
        where, kind = found
        self._send_bytes(where.read_bytes(), kind)

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
        self.allow_the_page()
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length) or b"{}")

    def do_OPTIONS(self) -> None:  # noqa: N802 — http.server's naming
        if self.refused():
            return
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.allow_the_page()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _dispatch(self, method: str, asked: dict) -> None:
        """Answer one request from the route table, or say there is no such route."""
        path, _, query = self.path.partition("?")
        handler = ROUTES.get((method, path))
        if handler is not None:
            self._answer(handler(asked, query))
        else:
            self._answer({"error": f"no route {path}"}, status=404)

    def do_GET(self) -> None:  # noqa: N802 — http.server's naming
        if self.refused():
            return
        path, _, query = self.path.partition("?")
        try:
            if path.startswith("/view/"):
                self._send_a_picture(path, query)
            elif path.startswith("/workflows/"):
                self._send_a_package_file(path)
            elif not path.startswith("/api/"):
                self._send_the_page(path)
            else:
                self._dispatch("GET", {})
        except Exception as why:  # noqa: BLE001
            self._fail(why)

    def do_POST(self) -> None:  # noqa: N802 — http.server's naming
        if self.refused():
            return
        try:
            self._dispatch("POST", self._body())
        except Exception as why:  # noqa: BLE001
            self._fail(why)

    def log_message(self, *_args) -> None:
        """Quiet: the terminal is the operator's too."""


def a_bridge_on(
    port: int, output_root: str | None = None, *, simulator_pixels=False,
) -> ThreadingHTTPServer:
    """A bridge ready to answer, with every driver this machine has.

    Both ways in -- run on its own, or started by the window -- build it
    here, so both offer the same list of microscopes, and both have the
    routes of every installed workflow's Python half.
    """

    state.simulator_pixels_enabled = bool(simulator_pixels)
    state.pixel_provider = None
    state.output_root = output_root
    workflows.load_python_halves(add_route, reserved=THE_BRIDGES_OWN)
    return ThreadingHTTPServer(("127.0.0.1", port), Bridge)


def serve(
    port: int = 8600, output_root: str | None = None, *, simulator_pixels=False,
) -> ThreadingHTTPServer:
    """Start a bridge in a background thread and hand back its server."""
    server = a_bridge_on(port, output_root, simulator_pixels=simulator_pixels)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


#: How long closing the window waits for a running scan to finish its field.
CLOSING_WAIT_S = 60.0


def shut_down(server: ThreadingHTTPServer) -> None:
    """Close everything a bridge holds, when the window it served is closed.

    A running scan is asked to stop between two fields, the session with the
    microscope is closed (which also stops the picture server and the
    analysis workers), and the bridge stops listening. Each part is closed
    even when the one before it fails -- a microscope that no longer answers
    must not keep the bridge open -- and what failed is said in the terminal.
    """
    for closing in (
        lambda: connecting.let_the_last_session_go(wait_s=CLOSING_WAIT_S),
        connecting.disconnect,
        server.shutdown,
        server.server_close,
    ):
        try:
            closing()
        except Exception as why:  # noqa: BLE001 -- the rest must still close
            print(f"while closing the interface: {why}", file=sys.stderr, flush=True)


def add_arguments(parser: argparse.ArgumentParser) -> None:
    """The choices the bridge takes, shared with the window's launcher."""
    parser.add_argument("--simulator-pixels", action="store_true",
                        help="synthetic pixels, only for captures identified as LAS X SIMULATOR")
    parser.add_argument("--output-root",
                        help="where runs go, for a driver that cannot discover its own")


def installed_workflows_report() -> str:
    """The workflows installed on this computer, one line each, for ``--workflows``."""
    found = workflow_library.installed()
    if not found:
        return f"no workflows are installed in {workflow_library.library()}"
    lines = [f"workflows installed in {workflow_library.library()}:"]
    for one in found:
        if one.get("error"):
            lines.append(f"  {one['folder']}: cannot be read -- {one['error']}")
        else:
            half = f", Python half {one['python']}" if one.get("python") else ""
            lines.append(f"  {one['folder']}: {one['name']} {one['version']} (framework {one['framework']}{half})")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    """Run the bridge on its own, serving the built page and the instrument."""
    parser = argparse.ArgumentParser(
        description="The bridge: the operator page's backend, serving the page and the instrument",
    )
    parser.add_argument("--port", type=int, default=8600)
    parser.add_argument("--workflows", action="store_true",
                        help="list the workflows installed on this computer, and stop")
    add_arguments(parser)
    args = parser.parse_args(argv)
    if args.workflows:
        print(installed_workflows_report())
        return 0
    server = a_bridge_on(args.port, args.output_root, simulator_pixels=args.simulator_pixels)
    print(f"bridge listening on 127.0.0.1:{args.port}")
    server.serve_forever()
    return 0
