"""ZMART interface: the operator window for smart microscopy.

The operator walks a run step by step -- connect, define the carrier, plan the
overview, measure a focus map, scan, find the targets, choose them, acquire
them -- in a window that draws the sample as it is acquired. Behind the window
sits the ZMART Controller, so the same window drives any microscope that has a
ZMART driver.

What is where:

- ``framework/``: the shell that runs a workflow -- the window (``window/``,
  in JavaScript; the built page in ``window/static/``), the rules for steps,
  and ``bridge.py``, the HTTP door through which the page reaches the
  controller.
- ``parts/``: what a workflow is built from -- the canvas and its drawing
  engines, the microscope seam, the storage of what a run captures, and the
  analysis that scores focus and finds objects.
- ``workflows/``: one folder per workflow; ``target_acquisition`` today.
- ``mock_microscope/``: a pretend microscope, plugged in like any driver, to
  try and test the interface without hardware.
- ``zmart_storage/``: declaring one OME-Zarr image, the part of ZMART's
  storage writer the interface uses.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

__version__ = "0.1.0rc1"
__author__ = "Thom de Hoog"
__email__ = "thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com"
__affiliation__ = "Center for Microscopy and Image Analysis (ZMB), University of Zurich"
