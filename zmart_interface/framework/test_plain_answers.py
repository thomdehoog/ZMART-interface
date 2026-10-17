"""A bad request is answered in a sentence, not in Python's own words.

From the review of 10 October, finding 19: requests answered the operator in
Python's own words -- a missing field (``'record'``), and ``{"x": null}``
("float() argument must be ..."). A missing field is named, and a value of
the wrong kind is a bad request (400), not a broken bridge.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import io
import json

from zmart_interface.framework.bridge import server


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


def test_a_missing_field_is_named_in_a_sentence(monkeypatch):
    monkeypatch.setitem(server.ROUTES, ("POST", "/api/needs-a-record"), lambda asked, query: asked["record"])
    status, said = answered("POST", "/api/needs-a-record", {})
    assert status == 400
    assert said["error"] == "the request is missing 'record'"


def test_a_value_of_the_wrong_kind_is_a_bad_request_not_a_broken_bridge(monkeypatch):
    monkeypatch.setitem(server.ROUTES, ("POST", "/api/wants-a-number"), lambda asked, query: float(asked["x"]))
    status, said = answered("POST", "/api/wants-a-number", {"x": None})
    assert status == 400
