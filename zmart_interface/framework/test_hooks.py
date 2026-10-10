"""The bridge is told by workflows what it used to know about them.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from zmart_interface.framework.bridge import hooks


@pytest.fixture(autouse=True)
def nothing_plugged_in(monkeypatch):
    monkeypatch.setattr(hooks, "plugged", {})


def test_a_run_has_the_stage_when_any_workflow_says_so():
    busy = {"one": False, "two": False}
    hooks.plug("one", holds_the_stage=lambda: busy["one"])
    hooks.plug("two", holds_the_stage=lambda: busy["two"])
    assert hooks.a_run_has_the_stage() is False
    busy["two"] = True
    assert hooks.a_run_has_the_stage() is True


def test_letting_go_and_forgetting_reach_every_workflow_once():
    said = []
    hooks.plug("one", let_go=lambda wait_s: said.append(("one", wait_s)), forget=lambda: said.append("forgot one"))
    hooks.plug("two", let_go=lambda wait_s: said.append(("two", wait_s)))
    hooks.let_go(30.0)
    hooks.forget()
    assert said == [("one", 30.0), ("two", 30.0), "forgot one"]


def test_plugging_in_again_replaces_what_the_name_had():
    said = []
    hooks.plug("one", forget=lambda: said.append("first"))
    hooks.plug("one", forget=lambda: said.append("second"))
    hooks.forget()
    assert said == ["second"]


def test_raw_kinds_and_drawn_pictures_are_found_by_kind_and_ending():
    drawn = Path("mask.png")
    hooks.plug("one", raw_kinds={"focussing"}, picture_endings={".mask.png": lambda kind, label: drawn})
    assert hooks.is_raw("focussing") and not hooks.is_raw("overview")
    ending, draw = hooks.drawing_for("P0.mask.png")
    assert ending == ".mask.png" and draw("overview", "P0") == drawn
    assert hooks.drawing_for("P0.jpg") is None


def test_with_nothing_plugged_in_the_bridge_is_idle():
    assert hooks.a_run_has_the_stage() is False
    hooks.let_go(1.0)
    hooks.forget()
    assert hooks.is_raw("focussing") is False
