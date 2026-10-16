"""The pictures only Target acquisition draws: a focus stack's slices and a field's detection masks.

The bridge's general part serves every picture under ``/view/<kind>/<name>``.
These are the ones this workflow makes for its own panels, and it tells the
bridge about them when it plugs in (see ``framework/bridge/hooks.py``): the
focussing kind's view folder is served as it is, and names ending in
``.mask.png`` or ``.labels.png`` are drawn here on request.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from __future__ import annotations

from zmart_interface.framework.bridge import pictures, state
from zmart_interface.parts.microscope.focus_run import FOCUSSING


def the_slice_copies_of(planes: list, *, store=None) -> list:
    """Small copies of one focus stack, one per height, for the panel's eye.

    Made as the point lands -- on the worker's time, never a request's -- and
    named to the page without their folder: where pictures are fetched from
    stays ``viewOf``'s answer. A stack that cannot be copied (a driver whose
    files are not canonical planes) costs the preview and never the run.
    """
    from zmart_interface.parts.storage.jpeg_tiles import make_slice_copies  # noqa: PLC0415

    try:
        if store is not None:
            return make_slice_copies(pictures.view_of(FOCUSSING), planes, store=store, budget_px=1024 * 1024)
        return make_slice_copies(pictures.view_of(FOCUSSING), planes)
    except Exception as why:  # noqa: BLE001 -- the preview is optional, the height is not
        import logging

        logging.getLogger(__name__).warning("no slice copies for a focus point: %s", why)
        return []


def the_mask_view_for(kind: str, label: str):
    """The colorized mask PNG for the *kind* field labelled *label*, or None."""
    from zmart_interface.parts.analysis.mask_view import mask_view_of

    for record in state.records.get(kind, []):
        if record.get("position_label") == label:
            return mask_view_of(record, label)
    return None


def the_label_map_for(kind: str, label: str):
    """The raw label-mask PNG for the *kind* field labelled *label*, or None."""
    from zmart_interface.parts.analysis.mask_view import label_map_of

    for record in state.records.get(kind, []):
        if record.get("position_label") == label:
            return label_map_of(record, label)
    return None
