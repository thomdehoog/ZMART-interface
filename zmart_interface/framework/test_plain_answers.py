"""The bridge never guesses a height, and answers a bad request in a sentence.

From the review of 10 October:

- Finding 9. A double-click drive names only x and y, and the axes it leaves
  out stay where the stage reports them. A driver that reported no z got
  ``set_xyz(x, y, 0.0)``: an absolute move to z = 0, the objective's own
  zero. The overview scan already refused to invent a height; the drive now
  does too.
- Finding 19. Three requests answered the operator in Python's own words:
  ``/api/setting?type=a=b`` ("dictionary update sequence element #0 ..."),
  a missing field (``'record'``), and ``{"x": null}`` ("float() argument
  must be ...").

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import io
import json

import pytest

from zmart_interface.framework.bridge import readings, server, stage, state
from zmart_interface.parts.microscope.instrument import Instrument


class Stage:
    """A stage that reports only the axes it is given, and remembers every move."""

    def __init__(self, **standing):
        self.context = {"driver": "stub"}
        self.standing = standing
        self.moves = []

    def get_xyz(self):
        return {"success": True, "content": {axis: {"position": v} for axis, v in self.standing.items()}}

    def set_xyz(self, x, y, z):
        self.moves.append((x, y, z))
        return {"success": True, "content": {"x": {"position": x}, "y": {"position": y}, "z": {"position": z}}}


def test_a_drive_never_sends_the_objective_to_a_height_nobody_reported(monkeypatch):
    held = Stage(x=0.0, y=0.0)
    monkeypatch.setattr(state, "session", Instrument(held))
    with pytest.raises(RuntimeError, match="does not say where the z axis stands"):
        stage.drive_to({"x": 100.0, "y": 200.0})
    assert held.moves == []


def test_a_drive_keeps_every_axis_it_was_not_asked_to_move(monkeypatch):
    held = Stage(x=1.0, y=2.0, z=-380.0)
    monkeypatch.setattr(state, "session", Instrument(held))
    stage.drive_to({"x": 100.0, "y": None})
    assert held.moves == [(100.0, 2.0, -380.0)]


def test_a_drive_to_something_that_is_not_a_number_says_so(monkeypatch):
    held = Stage(x=1.0, y=2.0, z=3.0)
    monkeypatch.setattr(state, "session", Instrument(held))
    with pytest.raises(ValueError, match="x must be a number of micrometres, not 'left'"):
        stage.drive_to({"x": "left"})
    assert held.moves == []


def answered(method, path, body=None):
    """Ask the bridge one route without a socket, and read back the status and the sentence."""

    class Probe(server.Bridge):
        def __init__(self):
            raw = json.dumps(body).encode() if body is not None else b""
            self.path = path
            self.headers = {"Host": "127.0.0.1:8600", "Content-Length": str(len(raw))}
            self.rfile = io.BytesIO(raw)
            self.wfile = io.BytesIO()
            self.status = None

        def send_response(self, status):
            self.status = status

        def send_header(self, name, value):
            pass

        def end_headers(self):
            pass

    probe = Probe()
    (probe.do_POST if method == "POST" else probe.do_GET)()
    return probe.status, json.loads(probe.wfile.getvalue())


def test_a_reading_asked_with_a_malformed_query_is_read_as_far_as_it_goes(monkeypatch):
    asked = []
    monkeypatch.setattr(readings, "reading", lambda kind: asked.append(kind) or {"kind": kind})
    monkeypatch.setattr(state, "session", object())
    status, said = answered("GET", "/api/setting?type=a=b&other")
    assert status == 200
    assert asked == ["a=b"]


def test_a_missing_field_is_named_in_a_sentence(monkeypatch):
    monkeypatch.setitem(server.ROUTES, ("POST", "/api/needs-a-record"), lambda asked, query: asked["record"])
    status, said = answered("POST", "/api/needs-a-record", {})
    assert status == 400
    assert said["error"] == "the request is missing 'record'"


def test_a_value_of_the_wrong_kind_is_a_bad_request_not_a_broken_bridge(monkeypatch):
    monkeypatch.setitem(server.ROUTES, ("POST", "/api/wants-a-number"), lambda asked, query: float(asked["x"]))
    status, said = answered("POST", "/api/wants-a-number", {"x": None})
    assert status == 400
