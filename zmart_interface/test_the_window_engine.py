"""On a Mac the window is drawn by Chromium through Qt, not by macOS's own WebKit.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import importlib.util

from zmart_interface import launcher


def _qt_installed(monkeypatch, installed: bool):
    monkeypatch.setattr(importlib.util, "find_spec", lambda name: object() if installed else None)


def test_a_mac_draws_with_chromium_through_qt(monkeypatch):
    monkeypatch.setattr(launcher.sys, "platform", "darwin")
    monkeypatch.delenv("PYWEBVIEW_GUI", raising=False)
    _qt_installed(monkeypatch, True)
    assert launcher._engine() == "qt"


def test_a_mac_without_qt_falls_back_to_webkit(monkeypatch):
    monkeypatch.setattr(launcher.sys, "platform", "darwin")
    monkeypatch.delenv("PYWEBVIEW_GUI", raising=False)
    _qt_installed(monkeypatch, False)
    assert launcher._engine() is None


def test_windows_keeps_webview2_and_a_choice_is_kept(monkeypatch):
    _qt_installed(monkeypatch, True)
    monkeypatch.setattr(launcher.sys, "platform", "win32")
    assert launcher._engine() is None
    monkeypatch.setattr(launcher.sys, "platform", "darwin")
    monkeypatch.setenv("PYWEBVIEW_GUI", "cocoa")
    assert launcher._engine() is None
