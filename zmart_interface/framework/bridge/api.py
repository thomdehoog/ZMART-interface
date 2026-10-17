"""What a workflow's Python half may use of the bridge: the one module of the framework it imports.

A workflow's Python half is a package ``<workflow folder>/bridge``. The bridge
imports it when it starts and asks it for four things, each optional but the
first:

- ``routes(register)`` — its routes. ``register(method, path, handler,
  prefix=False)`` adds one under ``/api/<folder>/``. A handler takes
  ``(asked, query)`` — the request's JSON body as a dictionary (empty for a
  GET) and the raw query string — and answers a dictionary, sent as JSON, or
  :class:`Bytes`. A *prefix* route answers every path that begins with its
  own, and its handler takes a third argument, the rest of the path.
- ``add_arguments(group)`` — its command-line options, in an argument group
  of its own.
- ``start(args)`` — what it does as the bridge starts, given the parsed
  options. It may answer the window's title.
- ``close(wait_s)`` — what it closes when the window is closed: a run in
  progress may be given ``wait_s`` seconds to finish what it is doing.

A handler that cannot do what was asked raises :class:`Refusal` with the
status to answer, and the page shows its sentence. A ``KeyError``, a
``ValueError`` or a ``TypeError`` is a request the bridge could not read, and
answers 400; anything else is the bridge's own fault and answers 500.
Handlers run on the bridge's request threads, several at once.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Bytes:
    """An answer that is not JSON: a picture, a file. Sent as it is and never kept by the browser."""

    body: bytes
    content_type: str


class Refusal(RuntimeError):
    """Asked for something that cannot be done, said in a sentence the page shows, with its status."""

    status = 409

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        if status is not None:
            self.status = status
