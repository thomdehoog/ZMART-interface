"""Only a page on this computer may drive the microscope through the bridge.

The bridge listens on 127.0.0.1, which keeps other computers out, but a web
page open in any browser on the microscope computer runs on that same
computer. Before these checks, such a page could send ``POST /api/xyz`` and
the stage moved: the bridge trusted every request that reached it. These
tests start a real bridge on a free port and ask it the way a browser would,
from a page served here and from one served anywhere else.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import http.client
import json
import threading
from http.server import ThreadingHTTPServer

import pytest

from zmart_interface.framework.bridge import server


@pytest.fixture()
def bridge(monkeypatch):
    """A bridge on a free port with one route that records that it was reached."""
    reached = []
    monkeypatch.setattr(server, "ROUTES", dict(server.ROUTES))
    server.add_route("POST", "/api/probe", lambda asked, query: reached.append(asked) or {"moved": True})
    server.add_route("GET", "/api/probe", lambda asked, query: reached.append("read") or {"read": True})
    listening = ThreadingHTTPServer(("127.0.0.1", 0), server.Bridge)
    threading.Thread(target=listening.serve_forever, daemon=True).start()
    yield listening.server_address[1], reached
    listening.shutdown()
    listening.server_close()


def ask(port, method, path, headers=None, body=None):
    """One request with exactly the headers given, as a browser or a script would send it."""
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    connection.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
    for name, value in (headers or {}).items():
        connection.putheader(name, value)
    payload = json.dumps(body).encode() if body is not None else b""
    connection.putheader("Content-Length", str(len(payload)))
    connection.endheaders(payload)
    answer = connection.getresponse()
    text = answer.read()
    connection.close()
    return answer.status, dict(answer.getheaders()), text


def test_the_page_served_by_the_bridge_itself_may_drive(bridge):
    port, reached = bridge
    status, headers, _ = ask(port, "POST", "/api/probe", {
        "Host": f"127.0.0.1:{port}", "Origin": f"http://127.0.0.1:{port}",
        "Content-Type": "application/json",
    }, {"x": 1})
    assert status == 200
    assert reached == [{"x": 1}]
    assert headers.get("Access-Control-Allow-Origin") == f"http://127.0.0.1:{port}"


def test_the_development_page_on_another_local_port_may_drive(bridge):
    """The dev server holds the page on its own port; it is still this computer."""
    port, reached = bridge
    status, headers, _ = ask(port, "POST", "/api/probe", {
        "Host": f"localhost:{port}", "Origin": "http://localhost:5174",
        "Content-Type": "application/json",
    }, {"x": 2})
    assert status == 200
    assert reached == [{"x": 2}]
    assert headers.get("Access-Control-Allow-Origin") == "http://localhost:5174"


def test_a_script_on_this_computer_without_an_origin_may_drive(bridge):
    """The tests, curl and the launcher's own check send no Origin; they run here."""
    port, reached = bridge
    status, _, _ = ask(port, "POST", "/api/probe", {"Host": f"127.0.0.1:{port}"}, {"x": 3})
    assert status == 200
    assert reached == [{"x": 3}]


def test_a_page_from_elsewhere_is_refused_before_anything_moves(bridge):
    """The reproduction from the review: text/plain, so a browser sends no preflight."""
    port, reached = bridge
    status, headers, text = ask(port, "POST", "/api/probe", {
        "Host": f"127.0.0.1:{port}", "Origin": "https://evil.example",
        "Content-Type": "text/plain",
    }, {"x": 1234})
    assert status == 403
    assert reached == []
    assert "Access-Control-Allow-Origin" not in headers
    assert "evil.example" in json.loads(text)["error"]


def test_a_sandboxed_or_file_page_is_refused(bridge):
    port, reached = bridge
    status, _, _ = ask(port, "POST", "/api/probe", {"Host": f"127.0.0.1:{port}", "Origin": "null"}, {})
    assert status == 403
    assert reached == []


def test_a_foreign_host_name_is_refused_so_a_renamed_address_cannot_reach_in(bridge):
    """A page that points its own name at 127.0.0.1 arrives with that name as Host."""
    port, reached = bridge
    status, _, _ = ask(port, "POST", "/api/probe", {"Host": f"evil.example:{port}"}, {"x": 1})
    assert status == 403
    status, _, _ = ask(port, "GET", "/api/probe", {"Host": f"evil.example:{port}"})
    assert status == 403
    assert reached == []


def test_a_cross_site_read_without_an_origin_is_refused(bridge):
    """An ``<img>`` on a foreign page sends no Origin, but the browser says where it came from."""
    port, reached = bridge
    status, _, _ = ask(port, "GET", "/api/probe", {
        "Host": f"127.0.0.1:{port}", "Sec-Fetch-Site": "cross-site",
    })
    assert status == 403
    assert reached == []


def test_the_preflight_names_only_a_local_page(bridge):
    port, _ = bridge
    status, headers, _ = ask(port, "OPTIONS", "/api/probe", {
        "Host": f"127.0.0.1:{port}", "Origin": "http://127.0.0.1:5174",
    })
    assert status == 204
    assert headers.get("Access-Control-Allow-Origin") == "http://127.0.0.1:5174"
    status, headers, _ = ask(port, "OPTIONS", "/api/probe", {
        "Host": f"127.0.0.1:{port}", "Origin": "https://evil.example",
    })
    assert status == 403
    assert "Access-Control-Allow-Origin" not in headers
