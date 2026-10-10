"""The bridge: where the operator window's backend verbs meet the controller.

The operator page runs in a browser and cannot import Python, so its backend
(`zmart_interface/parts/microscope/live.js`) speaks to this package over
HTTP instead. Every route is one of the page's backend verbs; behind each
route sits the ZMART Controller (:mod:`zmart_controller`), and behind that
whichever driver is plugged in — a real microscope's driver on the microscope
PC, or the interface's own mock microscope on a machine with no instrument.

Every command the controller answers comes back as ``{"success", "content"}``.
The bridge reads them through
:class:`~zmart_interface.parts.microscope.instrument.Instrument`, which hands
back the content and turns a ``success: False`` into a plain sentence the page
shows the operator.

One module per concern, and one that holds what they share:

* ``state`` — the open session, the run folder, and what every run captured.
* ``connecting`` — which microscopes are offered, connect and disconnect.
* ``readings`` — a preset is the instrument's state, shaped for the window;
  capture and apply settings are the controller's own verbs carried through.
* ``stage`` — where the stage is, and driving it.
* ``pictures`` — each capture's OME-Zarr position, and the pictures served.
* ``hooks`` — what a workflow tells the bridge: whether one of its runs holds
  the stage, what to stop before another session opens, what to forget when
  a fresh one does, and the pictures it draws itself.
* ``workflows`` — every workflow's Python half wired in at start-up: those
  that ship inside the interface (``zmart_interface/workflows/<folder>/bridge``)
  and those installed on this computer as packages, listed for the page.
* ``server`` — the HTTP routes as a table, the built page, the installed
  workflows' files, and ``serve``/``main``.

Nothing here knows any one workflow. A focus map, an overview scan, finding
and taking targets are Target acquisition's, in its own Python half
(``zmart_interface/workflows/target_acquisition/bridge``), with its routes
under ``/api/target_acquisition/``.

The verbs, and what they are made of
------------------------------------

* ``POST /api/connect`` — open the session through the controller. The reply
  carries the driver's own account of itself (``get_info``), which is what the
  window's connection checks show. ``GET /api/instruments`` lists what can be
  connected to, ``GET /api/info`` is the driver's account of the open session,
  and ``POST /api/disconnect`` closes it.
* ``GET  /api/setting`` — **a readout, never a procedure.** The instrument's
  current state (``get_state``), shaped into the reading the window records:
  a one-line summary, the detail rows behind it, and the frame size the plan
  is laid with. Recording a preset — the acquisition settings and the
  focussing preset alike — is this, and nothing more: nothing on the
  instrument moves.
* ``GET  /api/xyz`` — where the stage is (``get_xyz``), and
  ``POST /api/xyz`` — drive it there (``set_xyz``), answering with where it
  ended up. One noun, the method saying which of the controller's two verbs is
  meant. The page's backend calls them ``get_xyz`` and ``set_xyz`` too — the
  controller's own names, carried through the browser unchanged, because a
  verb that is spelled one way here and another way there is a verb somebody
  will eventually wire to the wrong one. A driven stage is a procedure and not
  a readout, which is why it is a POST and why nothing else on this route
  moves anything.
* ``GET  /api/acquisition_settings`` — what the instrument offers for a capture
  and what is chosen now (``get_acquisition_settings``), in the driver's own
  words. A readout: asking changes nothing.
* ``POST /api/state`` — change settings on the instrument (``set_state``),
  answering with what the driver says it applied. The body is the settings
  themselves; the bridge puts them in ``changeable``, which is where the
  contract says a client's instructions go.
* ``POST /api/acquire`` — capture once where the stage is standing
  (``acquire``), answering with the controller's own answer, untouched:
  ``{"success", "content"}``, the content's ``files`` naming every file saved and
  its ``planes`` which channel, depth and stage position each picture is. The
  one place a client learns the paths of the files a run made.
* ``GET /api/viewer`` — whether the picture server beside the run is up, and
  what it serves. ``GET /view/<acquisition>/<name>`` hands out one of a run's
  pictures.
* ``GET /api/workflows`` — the workflows installed on this computer as
  packages (``zmart_interface.register_workflow``), each with where its
  bundle is served, ``GET /workflows/<folder>/<file>``; the page loads them
  as it opens, beside the workflows built into it. A package's Python half
  adds its own routes under ``/api/<folder>/``. Anything else that is not
  ``/api/`` is the built page.

The routes are a table in ``server`` (``ROUTES``, filled by the ``@route``
decorator): one function per route, taking the request's body and query and
answering a dictionary.

One thread owns the instrument. Every route that touches the session takes
``state.the_instruments_turn`` first, so two requests can never move the
stage at once — the scan holds it per position, not for the whole run, so a
readout during a scan waits briefly rather than failing.

Run it on its own, for a browser instead of the window::

    python -m zmart_interface.framework.bridge --port 8600

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from .server import THE_PAGE, add_arguments, main, serve, shut_down

__all__ = ["THE_PAGE", "add_arguments", "main", "serve", "shut_down"]
