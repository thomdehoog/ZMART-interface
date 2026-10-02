# ZMART interface

[![python](https://img.shields.io/badge/python-3.11%20%7C%203.12-blue)](https://www.python.org/downloads/)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![tests](https://img.shields.io/badge/tests-pytest%20%7C%20vitest%20%7C%20playwright-blue)](#testing)
[![status](https://img.shields.io/badge/status-release%20candidate-orange)](#status)

<img src="docs/zmart-interface-icon.png" align="left" width="150" alt="ZMART interface">

The **ZMART interface** is the operator window for smart microscopy: it walks you through a run step by step, from connecting to the microscope to acquiring the targets you chose, and draws the sample as it is acquired.
It drives the microscope only through the [ZMART Controller](https://github.com/thomdehoog/ZMART-controller), so the same window works on any microscope that has a ZMART driver.
It is part of [**ZMART**](https://github.com/thomdehoog/ZMART-microscopy) (ZMB's Microscopy-Agnostic Research Toolkit), the tools we use for smart microscopy at the Center for Microscopy and Image Analysis (ZMB), University of Zurich.
<br clear="left"/>

## The Problem

A smart-microscopy run is a chain of decisions: where the sample is on the carrier, which
area to survey, how to keep it in focus, what counts as a target, and which targets to look
at closely. Done in the vendor's software, every one of those steps is manual, specific to
that microscope, and hard to repeat on the next sample. Done in a script, the operator loses
sight of the sample while it is being imaged, and a small mistake early in the chain is
found only at the end.

## The Solution

The interface turns the run into ten steps in a window, each with its own controls beside
a picture of the sample, and keeps every result where the operator can see and correct it:

1. **Connect** to a microscope chosen from the controller's list, and see what its driver
   reports: whether the stage answers, which limits and calibration it loaded, where images go.
2. **Define the carrier**: a slide, a dish or a well plate, aligned to the stage.
3. **Overview scan area**: the fields to survey, drawn on the carrier.
4. **Focus strategy**: a few focus points measured, and a focus map fitted through them.
5. **Scan the overview**: the survey, drawn on the canvas as each field lands.
6. **Detect objects**: the cells or structures in every field, found by ZMART-analysis.
7. **Discover targets**: gates drawn on plots of what was measured about each object.
8. **Target scan area**: where to look closely, placed over the chosen targets.
9. **Acquire targets**: each target imaged, with its own focussing first if you ask for it.
10. **Run protocol**: the whole run again on a new sample, with the settings of the last one.

It sits on top of the ZMART Controller, and two other ZMART parts plug into its sides:

- **The controller** carries every command to the microscope's driver: move, read the
  settings, acquire. Each command answers `{"success": ..., "report": ...}`; when the
  microscope says it could not do something, the interface shows that sentence where you
  pressed.
- **ZMART-analysis** scores the focus stacks and finds the objects, each step in its own
  environment, kept running between presses so a focus map is not slower than the stage.
- **ZMART-viewer** serves the run as it is written, so the canvas fills in field by field.

**The viewer slot.** The picture in the middle of the window is drawn by a *drawing
engine*, and the engine is pluggable: anything that offers the same small set of functions
(open an acquisition, follow it while it grows, show a named view, say where the operator
clicked) can fill the slot. Three engines ship with the interface today (two built on Viv
and deck.gl, one on neuroglancer). [The viewer slot](docs/viewer-slot.md) writes down what
an engine must offer, so that another viewer can be put in its place.

## Try it yourself

### Install

The interface needs Python 3.11 or 3.12, and on Windows the WebView2 runtime that draws its
window (already part of Windows 11). Create an environment from conda-forge, then install the
interface into it. This also installs the ZMART Controller, ZMART-viewer and the ZMART-analysis
engine:

```bash
conda create -n zmart-interface -c conda-forge python=3.12 pip git
conda activate zmart-interface
pip install "zmart-interface @ git+https://github.com/thomdehoog/ZMART-interface"
```

Focus maps and object detection run ZMART-analysis workflows, which live in a checkout of
the ZMART-analysis repository together with the environments they run in. Clone it, create
the environments its workflows need, and tell the interface where it is:

```bash
git clone https://github.com/thomdehoog/ZMART-analysis
python ZMART-analysis/workflows/focus/environments/setup_env.py --step main
python ZMART-analysis/workflows/object_analysis/environments/setup_env.py --step classical
set ZMART_ANALYSIS_WORKFLOWS=C:\path\to\ZMART-analysis
```

(Installing ZMART-analysis from that checkout with `pip install -e ZMART-analysis` does the
same without the variable.)

### Run it with the mock microscope

The interface always offers a pretend microscope, so you can walk a whole run without
hardware:

```bash
zmart-interface
```

The window opens on the first step with **Mock** chosen. Press **Connect**; a second small
window opens beside it, the mock's own software, where you choose the job each step is
imaged with (Overview, Focussing, Target, ...), the way you would in the vendor's software.
Its sample is a section of a mouse kidney; the first capture downloads it once.

### Run it on a microscope

Install the ZMART driver for your microscope and plug it into the controller once on that
computer (see the [ZMART drivers](https://github.com/thomdehoog/ZMART-drivers) and the
controller's [setup guide](https://github.com/thomdehoog/ZMART-controller/blob/main/docs/setup.md)).
Each driver also has a setup of its own, done once per microscope: its travel limits, the
zero point of its coordinates and, for some, the image orientation and objective calibration.
After that the microscope appears in the interface's list:

```bash
pip install "zmart-interface[drivers] @ git+https://github.com/thomdehoog/ZMART-interface"
zmart-interface
```

[Installing on a microscope](docs/install-on-a-microscope.md) walks through it on a ZMB
workstation, including the first checks to make on a new instrument.

### Status

This is a release candidate, 0.1.0rc1. The interface was taken out of the ZMART Microscopy
repository, where it has been used on a Leica STELLARIS 5 and its LAS X simulator; this
standalone version has been tested on the mock microscope. Two things are deliberately left for
later:

- **Setting a microscope up** (limits, origin, orientation, calibration) belongs to each
  driver's own setup, and is not a workflow of this interface yet.
- **One viewer engine**: the three engines in the viewer slot will later be merged with
  ZMART-viewer's own engine.

## Testing

The tests need no microscope: they run on the mock. From a clone of this repository, with
Node 22.12 or newer for the page:

```bash
pip install -e ".[test]"
npm ci
python -m pytest          # the bridge, the storage, the analysis seam, the mock
npm run test:unit         # the page's rules and arithmetic (vitest)
npm run build             # the page, as it ships inside the package
npx playwright install chromium
npx playwright test zmart_interface/workflows/target_acquisition/walk.spec.js
```

The last line is the main acceptance test: all ten steps walked on the built page, through the
real bridge and the mock microscope, with the focus map and the detection run through
ZMART-analysis. It needs the analysis environments above.

## Author
Thom de Hoog, Center for Microscopy and Image Analysis (ZMB), University of
Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).

## License
MIT License. See LICENSE file for details.

## Links

- [ZMART Microscopy](https://github.com/thomdehoog/ZMART-microscopy): the main repository, where the workflows begin
- [ZMART Controller](https://github.com/thomdehoog/ZMART-controller): the one vocabulary every microscope is driven with
- [ZMART drivers](https://github.com/thomdehoog/ZMART-drivers): the drivers that plug into the controller, one per microscope
- [ZMART viewer](https://github.com/thomdehoog/ZMART-viewer): the viewer that serves the run as it is acquired
- [ZMART analysis](https://github.com/thomdehoog/ZMART-analysis): the analysis engine that runs between acquisitions
- [ZMART AI agent](https://github.com/thomdehoog/ZMART-ai-agent): driving a microscope by asking in your own words
- [Center for Microscopy and Image Analysis (ZMB)](https://www.zmb.uzh.ch), University of Zurich
