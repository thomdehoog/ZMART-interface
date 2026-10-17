"""Three steps' Python half: the smallest a half can be, one route.

The framework's own fixture, so loading a half is tested without a microscope
and without any real workflow.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations


def routes(register) -> None:
    """``GET /api/three_steps/hello``."""
    register("GET", "hello", lambda asked, query: {"hello": "three steps"})
