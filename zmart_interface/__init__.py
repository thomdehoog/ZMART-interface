"""ZMART interface: the operator window for smart microscopy.

The operator walks a run step by step -- connect, define the carrier, plan the
overview, measure a focus map, scan, find the targets, choose them, acquire
them -- in a window that draws the sample as it is acquired. Behind the window
sits the ZMART Controller, so the same window drives any microscope that has a
ZMART driver.

What is where:

- ``framework/``: the shell that runs a workflow -- the window (``window/``,
  in JavaScript), the rules for steps, and ``bridge/``, the HTTP door through
  which the page reaches each workflow's Python half.
- ``parts/``: what more than one workflow is built from. Empty today: a part
  arrives here when a second workflow needs it (``parts/README.md``).
- ``workflows/``: one folder per workflow, all built into the page;
  ``target_acquisition`` today, with everything it asks of a microscope --
  its Python half, the mock microscope, the storage of what a run captures
  and the analysis. A workflow written in another repository is dropped into
  this folder and the page is built again (``docs/dropping-a-workflow-in.md``).

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

__version__ = "0.1.0rc8"
__author__ = "Thom de Hoog"
__email__ = "thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com"
__affiliation__ = "Center for Microscopy and Image Analysis (ZMB), University of Zurich"
