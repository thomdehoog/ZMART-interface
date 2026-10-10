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

* ``state`` — the open session, the run folder, and every run's ledger.
* ``connecting`` — which microscopes are offered, connect and disconnect.
* ``readings`` — a preset is the instrument's state, shaped for the window;
  capture and apply settings are the controller's own verbs carried through.
* ``stage`` — where the stage is, and driving it.
* ``focus`` — the focus map, one stack at a time.
* ``scan`` — the overview scan, in a background thread.
* ``discovery`` — finding the targets in the overview's fields.
* ``plots`` — the population's table and the plots drawn over it.
* ``targets`` — the target run, one tile at a time.
* ``pictures`` — each capture's OME-Zarr position, and the pictures served.
* ``protocols`` — the settings a run ran with, written beside it or saved by name.
* ``workflows`` — the workflows installed on this computer as packages, listed
  for the page, and each one's Python half wired in at start-up.
* ``server`` — the HTTP routes as a table, the built page, the installed
  workflows' files, and ``serve``/``main``.

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
* ``POST /api/focus/begin``, ``POST /api/focus/score`` and ``POST /api/focus/end``
  — the focus map, driven by the page one stack at a time: begin clears the
  focussing acquisition and names the stacks; the page drives (``/api/xyz``)
  and captures (``/api/acquire``) each; score files the stack, scores it and
  answers the point; end closes the map. ``POST /api/focus/stop`` is the
  operator's Interrupt reaching a scoring that has hung: it puts the analysis
  workers down, so that scoring answers. ``GET /api/focus/measure`` is the
  bridge's ledger of the points scored so far.
* ``POST /api/targets/acquire/begin``, ``POST /api/targets/acquire/focus``,
  ``POST /api/targets/acquire/landed`` and ``POST /api/targets/acquire/end``
  — the target run, driven by the page one tile at a time like the focus
  map: begin clears the targets acquisition (unless appending) and names the
  captures; the page drives and captures each, with a focussing stack first
  when the operator asked for one (``focus`` scores it under its own
  acquisition and answers the peak); landed files the target's record the
  way the scan filed its own; end closes the run. ``GET /api/targets/acquire``
  is the ledger, ``?since=N`` the records after the ones a page holds.
  ``POST /api/targets/raise`` puts one acquired target's frame on top of its
  neighbours in the picture.
* ``POST /api/plots/compute`` — a multidimensional plot (``pca`` or ``umap``)
  over the detected population, or the ids named, through ZMART-analysis;
  ``GET`` reads its progress, ``POST /api/plots/compute/stop`` puts it down,
  ``GET /api/plots/columns?kind=`` answers its two columns by id.
* ``POST /api/scan`` — start the overview scan in a background thread: drive
  to each position, acquire, report progress. ``GET /api/scan`` reads the
  progress. The window's live picture watches the run's own store, so nothing
  here needs to push pixels at the browser.
* ``POST /api/scan/stop`` and ``POST /api/targets/discover/stop`` — the
  operator's Interrupt: ask the run to stop between two fields. What was
  captured stands; the answer is the run as it stood, ``stopped`` set once
  the worker has honoured it.
* ``POST /api/targets/discover`` — find the targets in the overview's fields,
  all of them or the ones named, through the warm analysis; ``GET`` reads the
  progress, each field's targets appended as they are found.
* ``GET /api/protocols`` and ``POST /api/protocols`` — the protocols this
  machine has written, before and after connecting; ``POST /api/protocol``
  writes the run's settings beside it, ``POST /api/protocol/save`` into the
  machine's library by name.
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
