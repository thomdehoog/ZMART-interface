"""What a workflow's Python half is given by the bridge, and what the bridge asks of it.

A half registers routes, answers with a dictionary or with bytes, refuses with
a status of its own, and may take part in starting and stopping the bridge:
its own command-line options, what it does at start (which may name the
window), and what it closes at the end. These are tried with the framework's
own fixture, ``three_steps``, and with halves made up here, so none of them
needs a microscope.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import argparse
import json
import threading
import types
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from zmart_interface.framework.bridge import api, server, workflows

FIXTURES = Path(__file__).resolve().parent / "fixtures"


@pytest.fixture()
def a_running_bridge(monkeypatch):
    """A bridge on a free port, with a route table of its own."""
    monkeypatch.setattr(server, "ROUTES", {})
    monkeypatch.setattr(server, "PREFIX_ROUTES", {})
    listening = server.serve(0, halves=[])
    at = f"http://127.0.0.1:{listening.server_address[1]}"
    try:
        yield at
    finally:
        listening.shutdown()
        listening.server_close()


def ask(address: str):
    try:
        with urllib.request.urlopen(address, timeout=10) as answer:
            return answer.status, dict(answer.headers), answer.read()
    except urllib.error.HTTPError as refused:
        return refused.code, dict(refused.headers), refused.read()


def test_a_prefix_route_is_handed_the_rest_of_the_path(a_running_bridge):
    server.add_route("GET", "/api/somewhere/view/", lambda asked, query, rest: {"rest": rest, "query": query},
                     prefix=True)
    status, _, body = ask(f"{a_running_bridge}/api/somewhere/view/overview/P0001.jpg?x=1")
    assert status == 200
    assert json.loads(body) == {"rest": "overview/P0001.jpg", "query": "x=1"}


def test_an_exact_route_is_preferred_to_a_prefix(a_running_bridge):
    server.add_route("GET", "/api/somewhere/", lambda asked, query, rest: {"from": "prefix"}, prefix=True)
    server.add_route("GET", "/api/somewhere/exact", lambda asked, query: {"from": "exact"})
    assert json.loads(ask(f"{a_running_bridge}/api/somewhere/exact")[2]) == {"from": "exact"}
    assert json.loads(ask(f"{a_running_bridge}/api/somewhere/else")[2]) == {"from": "prefix"}


def test_bytes_are_sent_as_they_are_and_never_kept(a_running_bridge):
    server.add_route("GET", "/api/somewhere/picture", lambda asked, query: api.Bytes(b"\x89PNG", "image/png"))
    status, headers, body = ask(f"{a_running_bridge}/api/somewhere/picture")
    assert status == 200 and body == b"\x89PNG"
    assert headers["Content-Type"] == "image/png"
    assert headers["Cache-Control"] == "no-store"


def test_a_refusal_answers_with_its_own_status_and_sentence(a_running_bridge):
    def refuse(asked, query):
        raise api.Refusal("nothing has been imaged there", status=404)

    server.add_route("GET", "/api/somewhere/refused", refuse)
    status, _, body = ask(f"{a_running_bridge}/api/somewhere/refused")
    assert status == 404
    assert json.loads(body) == {"error": "nothing has been imaged there"}


def test_a_refusal_without_a_status_answers_409(a_running_bridge):
    """The instrument's own "I could not", told apart from a broken bridge."""
    def declines(asked, query):
        raise api.Refusal("the microscope could not move: outside the travel")

    server.add_route("GET", "/api/somewhere/declined", declines)
    status, _, body = ask(f"{a_running_bridge}/api/somewhere/declined")
    assert status == 409
    assert json.loads(body) == {"error": "the microscope could not move: outside the travel"}


def test_the_fixtures_half_is_found_and_its_routes_land_under_its_folder(monkeypatch):
    monkeypatch.setattr(server, "ROUTES", {})
    halves = workflows.load_halves(server.add_route, folder=FIXTURES)
    assert [name for name, _ in halves] == ["three_steps"]
    assert server.ROUTES[("GET", "/api/three_steps/hello")]({}, "") == {"hello": "three steps"}


def test_each_half_has_its_own_options_starts_and_names_the_window():
    started = []
    ours = types.SimpleNamespace(
        add_arguments=lambda group: group.add_argument("--ours", action="store_true"),
        start=lambda args: started.append(args.ours) or "ZMART — OURS",
    )
    quiet = types.SimpleNamespace()
    parser = argparse.ArgumentParser()
    server.add_arguments(parser, [("ours", ours), ("quiet", quiet)])
    assert any(group.title == "ours" for group in parser._action_groups)
    args = parser.parse_args(["--ours"])
    listening = server.a_bridge_on(0, args, halves=[("ours", ours), ("quiet", quiet)])
    try:
        assert started == [True]
        assert listening.title == "ZMART — OURS"
    finally:
        listening.server_close()


def test_without_a_half_that_names_it_the_window_is_called_zmart():
    listening = server.a_bridge_on(0, halves=[])
    try:
        assert listening.title == "ZMART"
    finally:
        listening.server_close()


def test_closing_closes_every_half_even_when_one_fails(capsys):
    closed = []

    def breaks(wait_s):
        raise ConnectionError("the microscope software has closed")

    first = types.SimpleNamespace(close=breaks)
    second = types.SimpleNamespace(close=lambda wait_s: closed.append(wait_s))
    listening = server.a_bridge_on(0, halves=[("first", first), ("second", second)])
    threading.Thread(target=listening.serve_forever, daemon=True).start()
    server.shut_down(listening)
    assert closed == [server.CLOSING_WAIT_S]
    assert "the microscope software has closed" in capsys.readouterr().err
