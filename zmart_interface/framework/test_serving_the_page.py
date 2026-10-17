"""The bridge hands out the page it was built with, and nothing else of the disk.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import io

from zmart_interface.framework.bridge import server


def test_the_bridge_hands_out_the_page_it_was_built_with(tmp_path, monkeypatch):
    """One program on the microscope: the page it draws and the instrument it drives.

    That is also why the page looks for the bridge at its own origin and has
    to be told where it is only in development, where a dev server holds the
    page instead so that edits reload live.
    """
    built = tmp_path / "build"
    (built / "sub").mkdir(parents=True)
    (built / "index.html").write_text("<!doctype html>the page", encoding="utf-8")
    (built / "worker.js").write_text("// a background program", encoding="utf-8")
    (built / "notes.txt").write_text("not part of a page", encoding="utf-8")
    monkeypatch.setattr(server.Bridge, "PAGE", dict(server.Bridge.PAGE))
    monkeypatch.setattr(server, "THE_PAGE", built)

    handed = asked_for(["/", "/worker.js"])
    assert handed["/"] == (200, "text/html")
    # A browser will not start a background program from a file it was told is
    # anything but JavaScript, and it says nothing when it refuses.
    assert handed["/worker.js"] == (200, "text/javascript")

    refused = asked_for(["/notes.txt", "/../secrets", "/sub"])
    assert all(status == 404 for status, _kind in refused.values()), refused


def asked_for(paths):
    """Ask the page-serving route for each path, without a socket."""
    said = {}

    class Probe(server.Bridge):
        def __init__(self):
            self.sent = None
            self.headers = {}

        def _answer(self, payload, status=200):
            self.sent = (status, None)

        def send_response(self, status):
            self.sent = (status, None)

        def send_header(self, name, value):
            if name == "Content-Type":
                self.sent = (self.sent[0], value)

        def end_headers(self):
            pass

        @property
        def wfile(self):
            return io.BytesIO()

    for path in paths:
        probe = Probe()
        probe._send_the_page(path)
        said[path] = probe.sent
    return said
