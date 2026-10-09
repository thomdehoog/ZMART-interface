# Installing the interface on a microscope

What to install, where it must live, and in which order, on a Windows microscope PC. Keep the
previous installation and environment until the new one has passed the first checks below, so
that you can go back to it.

## What runs where

Everything runs from one conda environment on the microscope PC:

| Part | What it is | Where it comes from |
| --- | --- | --- |
| The interface | the operator window, its page and its bridge | `thomdehoog/ZMART-interface` |
| The controller | the one vocabulary every microscope is driven with | `thomdehoog/ZMART-controller`, installed with the interface |
| The viewer | the picture server that shows the run as it is written | `thomdehoog/ZMART-viewer`, installed with the interface |
| The analysis engine | runs focus scoring and object detection | `thomdehoog/ZMART-analysis`, installed with the interface |
| The analysis workflows | the pipelines, and the conda environments they run in | a checkout of `thomdehoog/ZMART-analysis` |
| The driver | speaks to the microscope's own software | `thomdehoog/ZMART-drivers`, with the extra for your microscope |

## Where things must live

On the ZMB workstations AppLocker refuses to run programs from folders a user can write to.
Everything that runs goes under `C:\ProgramData\MinicondaZMB`: the environment, the
ZMART-analysis checkout, and (for the tests only) the Playwright browsers. A checkout on the
Desktop, in Downloads or under `AppData` can install cleanly and still fail to run. Never run
from a network share.

The temporary folder matters too: the analysis engine starts each workflow's environment
through a small script it writes into `%TEMP%`, and a `TEMP` outside the allowed folders is
refused with "This program is blocked by group policy".

The computer's ZMART configuration -- which drivers are registered, each driver's limits,
origin and calibration, the interface's saved protocols and the workflows installed as
packages -- lives under `C:\ProgramData\zmart-microscopy\` (or wherever
`ZMART_MICROSCOPY_ROOT` points). Saved protocols are in its `zmart-interface\protocols`
folder (`ZMART_PROTOCOL_LIBRARY` names another), installed workflows in
`zmart-interface\workflows` (`ZMART_WORKFLOW_LIBRARY` names another).

## Order of work

### 1. The environment

Conda-forge only; never the `defaults` channel.

```powershell
conda create -n zmart-interface -c conda-forge -c nodefaults python=3.12 pip git
conda activate zmart-interface
```

### 2. The interface, the controller, the viewer and the analysis engine

```powershell
pip install "zmart-interface[drivers] @ git+https://github.com/thomdehoog/ZMART-interface"
pip check
```

The built page comes inside the package, so nothing is built on the microscope.

### 3. The analysis workflows

```powershell
cd C:\ProgramData\MinicondaZMB\home\<user>
git clone https://github.com/thomdehoog/ZMART-analysis
python ZMART-analysis\workflows\focus\environments\setup_env.py --step main
python ZMART-analysis\workflows\object_analysis\environments\setup_env.py --step classical
python ZMART-analysis\workflows\object_analysis\environments\setup_env.py --step cellpose   # Robust detection only
python ZMART-analysis\workflows\object_analysis\environments\setup_env.py --step umap       # the multidimensional plots
setx ZMART_ANALYSIS_WORKFLOWS C:\ProgramData\MinicondaZMB\home\<user>\ZMART-analysis
```

(Installing ZMART-analysis from this checkout with `pip install -e` does the same without
the variable.) Fast detection runs its fields twelve at a time in the classical environment;
the first press of a session pays the start-up of those workers once.

### 4. The driver

Install the driver's extra (for the Leica: `pip install "zmart-drivers[leica] @ git+https://github.com/thomdehoog/ZMART-drivers"`),
and do the driver's own setup for this microscope -- its limits, origin and, for the Leica,
the image orientation and objective calibration. Each driver's README says how. The driver
loads that setup every time it connects, and the interface's Connect step shows what it
loaded.

Then install the driver into the controller's registry, once on this computer, by pointing
it at the driver's `zmart_driver.json` or the folder holding it. That file gives the driver's
name and the connection it needs; the command prints the name:

```powershell
python -c "import zmart_drivers.leica.stellaris5_y42h93.navigator_expert as d, zmart_controller, pathlib; print(zmart_controller.register_driver(pathlib.Path(d.__file__).parent))"
```

The Connect step then offers it under that name, beside the two pretend microscopes.

### 5. Launch

The vendor's software (LAS X, with the CAM API and the intended jobs set up, on the Leica) must
be running before the window connects.

```powershell
zmart-interface
```

This opens the operator window with its bridge beside it. Never pass `--simulator-pixels` on a
real instrument. For a browser instead of the window:
`python -m zmart_interface.framework.bridge --port 8600` and open `http://127.0.0.1:8600`.
One controlling process at a time.

For a dry run without the instrument, choose **Mock** on the Connect step.

### 6. Workflows from other repositories (optional)

The page comes with target acquisition built in. A workflow written in another repository
-- yours, or a colleague's -- arrives as a package: a folder holding a `workflow.json` and a
built `flow.bundle.js` (`docs/writing-a-workflow.md` says how one is written and built).
Install it once on this computer, in the interface's environment, and list what is installed:

```powershell
python -c "import zmart_interface; print(zmart_interface.register_workflow(r'C:\path\to\the\package'))"
python -m zmart_interface.framework.bridge --workflows
```

The package is copied into the computer's workflow library (above), and the chooser at the
top left of the window offers the workflow the next time the window opens. Nothing is
rebuilt. A package written for another version of the interface is listed greyed in the
chooser, with the reason when the pointer rests on it, and the reason is also in the
window's console. If the package names a Python module, that module must be importable from
this environment too (`pip install` it); a module that cannot be imported leaves the
workflow greyed with the import error.

## First checks on a new instrument

1. Connect, and read the connection checks. If the limits are a fallback rather than this
   microscope's own, stop and do the driver's setup first; never work without limits.
2. In a safe region, one flat image and one small stack. Check the pixels, the XY placement and
   Z against the vendor's software.
3. Place three or four focus points spread over the area, not in a line. Read the map's label:
   "exact fit" means as many points as the model has parameters, an rms means the surface had
   points to spare.
4. Scan a few positions. The picture is the projection of each position; a stack is its
   brightest plane.
5. Test detection on one tile before the whole sample. The threshold is in raw counts.
6. Acquire a few targets and look at the pairs in the list.

Only after these, larger acquisitions. The mock and the LAS X simulator prove the software,
never the stage calibration, the optics or the throughput of the real instrument.

## Going back

Keep the previous environment. Going back is a matter of activating the old environment and
starting its window; run data written by the new one stays readable.
