"""The open microscope, as the interface talks to it: every answer already unwrapped.

The ZMART Controller answers every command with the same two-part reply::

    {"success": True,  "content": {...}}   the microscope did what was asked
    {"success": False, "content": ...}     it could not, and it was safe to say so

Something unsafe to carry on from is not answered at all; the driver raises
instead, a ``ValueError`` for a mistake in the request and a ``RuntimeError``
for a failure on the microscope.

The interface reads the ``content`` in many places -- where the stage is, what
the instrument is set to, what a capture wrote -- and every one of them would
otherwise have to unwrap the reply and decide what a ``success: False`` means.
:class:`Instrument` does that once. Each method returns the content itself, and
a reply that says the microscope could not do it becomes
:class:`InstrumentDeclined`, carrying a sentence the operator can read: the
bridge hands that sentence to the page, which shows it where the press was
made. Nothing is retried and nothing is guessed: a declined move is a move
that did not happen, and the operator is the one to decide what comes next.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

import json
from typing import Any

from zmart_interface.framework.bridge.api import Refusal

from ..storage.output import prepare_acquisition


class InstrumentDeclined(Refusal):
    """The microscope answered, and said it could not do what was asked.

    The message is written for the operator: what was asked, and what the
    driver said about it. ``content`` keeps the driver's own words whole, for
    anything that wants to read more than the sentence. A refusal (409), not a
    broken bridge: whoever reads the log sees the instrument's own answer.
    """

    def __init__(self, doing: str, content: Any) -> None:
        super().__init__(f"the microscope could not {doing}: {_in_words(content)}")
        self.content = content


def _in_words(content: Any) -> str:
    """The driver's explanation as one line of text, however it gave it."""
    if isinstance(content, str) and content.strip():
        return content.strip()
    if isinstance(content, dict):
        for key in ("reason", "message", "error", "why"):
            said = content.get(key)
            if isinstance(said, str) and said.strip():
                return said.strip()
    if content in (None, "", {}, []):
        return "the driver gave no reason"
    return json.dumps(content, default=str)


def unwrap(answer: Any, doing: str) -> Any:
    """The content inside one controller reply, or :class:`InstrumentDeclined`.

    ``doing`` says what was asked, in the words the operator would use
    ("move the stage", "capture an image"), because it becomes the start of
    the sentence they read when the microscope says no. A reply that is not
    in the controller's two-part shape is a driver that does not follow the
    contract, and that is said plainly rather than read as if it did.
    """
    if not isinstance(answer, dict) or "success" not in answer or "content" not in answer:
        raise RuntimeError(
            f"the driver's answer when asked to {doing} is not in the controller's "
            '{"success": ..., "content": ...} shape, so it cannot be read safely'
        )
    if answer["success"] is not True:
        raise InstrumentDeclined(doing, answer["content"])
    return answer["content"]


class Instrument:
    """A controller session whose methods return the content rather than the reply.

    Wraps the :class:`zmart_controller.ZmartController` the bridge opened.
    ``context`` names the driver that was plugged in (``{"driver": ...}``),
    as the controller does. Every other method calls the session's command of the same
    name and returns its content, or raises :class:`InstrumentDeclined`.
    """

    def __init__(self, session: Any) -> None:
        self._session = session
        self.context = dict(session.context)
        #: The run this session captures into, set at connect: each kind of
        #: acquisition is saved in its own folder of it. Without a run, the
        #: driver saves where it was set up to.
        self.run: Any = None

    def get_info(self) -> dict:
        return unwrap(self._session.get_info(), "describe itself")

    def get_state(self) -> dict:
        return unwrap(self._session.get_state(), "read its settings")

    def set_state(self, state: dict) -> Any:
        return unwrap(self._session.set_state(state), "apply the settings")

    def get_xyz(self) -> dict:
        return unwrap(self._session.get_xyz(), "say where the stage is")

    def set_xyz(self, x: float, y: float, z: float) -> Any:
        return unwrap(self._session.set_xyz(x, y, z), "move the stage")

    def get_acquisition_settings(self) -> dict:
        return unwrap(self._session.get_acquisition_settings(), "list its capture settings")

    def acquire(self, *, position_label: str, acquisition_settings: dict | None = None,
                acquisition_type: str | None = None) -> dict:
        return unwrap(
            self.acquire_answer(
                position_label=position_label, acquisition_settings=acquisition_settings,
                acquisition_type=acquisition_type,
            ),
            "capture an image",
        )

    def acquire_answer(self, *, position_label: str, acquisition_settings: dict | None = None,
                       acquisition_type: str | None = None) -> dict:
        """``acquire``'s answer exactly as the controller gives it.

        ``{"success": ..., "content": ...}``, with the content's ``files`` and
        ``planes`` as the driver wrote them. The page asks for a capture this
        way, so it reads the same answer a Python script would.

        ``acquisition_type`` is the interface's own name for which acquisition
        this capture belongs to (``"overview"``, ``"focussing"``, ...). The
        driver puts it in its file names and metadata, beside the label. With
        a run open, the driver is also given the run's ``data`` folder for
        that acquisition to save in; a driver whose software saves in its own
        place saves there instead, and the answer lists where. A driver never
        overwrites an earlier file, so a label taken again in the run is saved
        under a name of its own.
        """
        output_folder = None
        if acquisition_type is not None and self.run is not None:
            output_folder = str(prepare_acquisition(self.run, acquisition_type).data)
        return self._session.acquire(
            position_label=position_label, acquisition_settings=acquisition_settings,
            acquisition_type=acquisition_type, output_folder=output_folder,
        )

    def disconnect(self) -> None:
        self._session.disconnect()
