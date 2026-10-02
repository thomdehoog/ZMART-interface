"""The open microscope, as the interface talks to it: every answer already unwrapped.

The ZMART Controller answers every command with the same two-part reply::

    {"success": True,  "report": {...}}   the microscope did what was asked
    {"success": False, "report": ...}     it could not, and it was safe to say so

Something unsafe to carry on from is not answered at all; the driver raises
instead, a ``ValueError`` for a mistake in the request and a ``RuntimeError``
for a failure on the microscope.

The interface reads the ``report`` in many places -- where the stage is, what
the instrument is set to, what a capture wrote -- and every one of them would
otherwise have to unwrap the reply and decide what a ``success: False`` means.
:class:`Instrument` does that once. Each method returns the report itself, and
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


class InstrumentDeclined(RuntimeError):
    """The microscope answered, and said it could not do what was asked.

    The message is written for the operator: what was asked, and what the
    driver said about it. ``report`` keeps the driver's own words whole, for
    anything that wants to read more than the sentence.
    """

    def __init__(self, doing: str, report: Any) -> None:
        super().__init__(f"the microscope could not {doing}: {_in_words(report)}")
        self.report = report


def _in_words(report: Any) -> str:
    """The driver's explanation as one line of text, however it gave it."""
    if isinstance(report, str) and report.strip():
        return report.strip()
    if isinstance(report, dict):
        for key in ("reason", "message", "error", "why"):
            said = report.get(key)
            if isinstance(said, str) and said.strip():
                return said.strip()
    if report in (None, "", {}, []):
        return "the driver gave no reason"
    return json.dumps(report, default=str)


def unwrap(answer: Any, doing: str) -> Any:
    """The report inside one controller reply, or :class:`InstrumentDeclined`.

    ``doing`` says what was asked, in the words the operator would use
    ("move the stage", "capture an image"), because it becomes the start of
    the sentence they read when the microscope says no. A reply that is not
    in the controller's two-part shape is a driver that does not follow the
    contract, and that is said plainly rather than read as if it did.
    """
    if not isinstance(answer, dict) or "success" not in answer or "report" not in answer:
        raise RuntimeError(
            f"the driver's answer when asked to {doing} is not in the controller's "
            '{"success": ..., "report": ...} shape, so it cannot be read safely'
        )
    if answer["success"] is not True:
        raise InstrumentDeclined(doing, answer["report"])
    return answer["report"]


class Instrument:
    """A controller session whose methods return reports rather than replies.

    Wraps the :class:`zmart_controller.Session` the bridge opened. ``context``
    says which driver it is (``vendor``, ``microscope``, ``api``), as the
    session does. Every other method calls the session's command of the same
    name and returns its report, or raises :class:`InstrumentDeclined`.
    """

    def __init__(self, session: Any) -> None:
        self._session = session
        self.context = dict(session.context)

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

    def get_acquisition_options(self) -> dict:
        return unwrap(self._session.get_acquisition_options(), "list its capture options")

    def acquire(self, *, acquisition_type: str, position_label: str,
                options: dict | None = None) -> dict:
        return unwrap(
            self._session.acquire(
                acquisition_type=acquisition_type, position_label=position_label, options=options,
            ),
            "capture an image",
        )

    def disconnect(self) -> None:
        self._session.disconnect()
