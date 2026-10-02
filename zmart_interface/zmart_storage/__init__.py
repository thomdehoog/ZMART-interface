"""Writing one OME-Zarr image: the part of ZMART's storage writer this interface uses.

Every capture the interface keeps is converted, the moment it lands, into one
OME-Zarr image of its own -- one position, its channels, its planes, and a
few progressively smaller copies for viewing it zoomed out (see
``zmart_interface/parts/storage/zarr_positions.py``). Declaring such an image
is all this package does: it writes an empty image of the right shape, with a
description a viewer can read, and hands back its levels to be filled.

It is a small part of the writer kept in ZMART-microscopy (``zmart_storage``),
brought here because that writer has no standalone home yet. Only what the
interface calls was brought: the channel description, declaring one image,
and how many zoomed-out copies a position can keep.

Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
"""

from zmart_interface.zmart_storage.images import (
    Channel,
    declare_image,
    how_many_copies_a_position_can_keep,
)

__all__ = ["Channel", "declare_image", "how_many_copies_a_position_can_keep"]
