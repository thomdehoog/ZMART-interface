"""Each capture becomes one position of the run, in the format chosen at Connect.

The instrument writes what it writes. LAS X, for example, leaves OME-TIFFs,
and fighting a vendor's own export is a losing game, so the vendor's files are
used as well as possible and then, the moment a capture lands, turned into the
run's own form: **one position per capture, axes t/c/z/y/x**, with its stage
corner recorded inside it where nobody can rename it away. The vendor's files
stay untouched in ``data/``; the positions stand in ``positions/`` beside them.

A run is saved in one of two formats, chosen when connecting (:data:`FORMATS`):

- **OME-TIFF** (the default): one ``.ome.tif`` file per position, holding
  every channel and plane, with smaller copies of the picture stored inside it
  in the standard way. It opens with a drag and drop in Fiji, napari, QuPath
  or Imaris, as one stack with the right pixel size and channel names. What
  OME-XML has no place for (how the planes of a stack were taken) is kept in a
  small ZMART note inside the file, which other programs skip.
- **OME-Zarr 0.5**: one ``.ome.zarr`` image per position, the format of
  choice for very large data and for reading over a network.

Both carry the same information, and the ZMART viewer and analysis read both.
This module is the one place in the interface that knows the two apart: the
rest asks it whether something is a position, how large its pixels are and
how wide its frame is, and never needs to know which format answered.

One folder per acquisition type, holding nothing but positions, is exactly
the shape the ZMART viewer opens as one acquisition: the overview, the
focussing and the target scans each become a source of their own, and the
viewer links a folder's positions into one picture without copying a voxel.

For OME-Zarr, the declaration of the store is not done here:
:func:`zmart_interface.zmart_storage.declare_image` already writes the five
axes, the per-level scale and translation, and the channel description, and
saying any of that twice is how the two copies drift. This module reads the
vendor's planes and builds each smaller level by averaging 2 × 2 pixels, for
either format alike. A position is complete before it is published, so it
keeps all of its signal at every level of detail.

What the vendor's file does not say, the run's record does: a TIFF's OME block
carries the pixel size, but where a capture was taken comes from the record's
own planes (``x_um``/``y_um``/``z_um``), because the acquisition is the only
party that knows. The image axes are taken to lie along the stage axes — the
same single-place assumption as ``detection.IMAGE_TO_STAGE`` — and the
recorded stage point is the centre of the frame, so the corner written into
the position is half a frame up and left of it.

Author: Thom de Hoog (ZMB, University of Zurich).
License: MIT
"""

from __future__ import annotations

import json
import math
import os
import re
import shutil
import time
import uuid
import xml.etree.ElementTree as ElementTree
from functools import lru_cache
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr

import numpy as np

from zmart_interface.zmart_storage import (
    Channel,
    declare_image,
    how_many_copies_a_position_can_keep,
)

#: The two formats a run's positions can be saved in, as the Connect step
#: offers them: OME-TIFF first, and the default.
FORMATS = ("ome-tiff", "ome-zarr")
DEFAULT_FORMAT = "ome-tiff"

#: The ending each format's positions are named with.
ENDINGS = {"ome-tiff": ".ome.tif", "ome-zarr": ".ome.zarr"}

#: The endings an OME-TIFF may have, written by ZMART or by another program.
_TIFF_ENDINGS = (".ome.tif", ".ome.tiff")

#: The namespace of ZMART's note inside an OME-TIFF position. The ZMART viewer
#: reads the same note: ``zmart_microscopy`` (how the planes were taken, as
#: JSON), ``pyramid`` (``mean``: each smaller copy averages 2 × 2 pixels) and
#: ``position_origin`` (``corner``: the stage position given is the corner of
#: the picture, not its middle). Another program's OME-TIFF has no such note,
#: and is turned into a position rather than used as one.
ZMART_NOTE = "zmart/position"

#: How hard an OME-TIFF's pixels are packed: deflate, at its fastest level.
#: Measured on fluorescence stacks, it writes a file about a third of the raw
#: size in a third of a second per 100 MB, quick enough for a live run, and
#: Fiji, QuPath and Imaris (through Bio-Formats) and napari all read it.
_DEFLATE_LEVEL = 1

#: The chunk edge in y and x, matching the run stores ZMART's writer makes.
#: An OME-TIFF position is cut into tiles of the same size.
PIECE = 128

#: Metres and friends, as OME spells them, into micrometres. OME's default
#: unit for a physical size is µm, so a missing unit multiplies by one.
_TO_UM = {"m": 1e6, "mm": 1e3, "µm": 1.0, "um": 1.0, "nm": 1e-3, "": 1.0}


#: How many times a position is written before a denied rename is given up
#: on, and how long to wait between tries. Windows refuses to rename a file
#: another process holds open -- a scanner, a folder watcher -- for a moment;
#: the interface's own bridge lost one position in three that way, with the
#: development server watching the folder it wrote to.
WRITE_ATTEMPTS = 3
WRITE_RETRY_S = 0.3


def checked_format(asked: str | None) -> str:
    """The format a run is saved in: the one asked for, or the default when none was.

    Raises ``ValueError`` naming the formats when the word is not one of them.
    """
    chosen = asked or DEFAULT_FORMAT
    if chosen not in FORMATS:
        raise ValueError(f"a run is saved as one of {list(FORMATS)}, not {chosen!r}")
    return chosen


def position_from_record(
    record: dict, into: Path | str, *, format: str, pixel_provider=None,
) -> Path:
    """Write one position from a capture's record, in the run's format, and return it.

    ``record`` is what the driver's acquire returned — its ``planes`` name the
    vendor's files and where each was taken. ``into`` is the acquisition's
    ``positions`` folder; the position lands there as
    ``<acquisition type>_<position_label>`` with the format's ending, an
    ordinary OME-TIFF or OME-Zarr image that opens on its own in Fiji, napari
    or the ZMART viewer. ``format`` is one of :data:`FORMATS`.

    A rename the file system denies is tried again, in a fresh place, up to
    :data:`WRITE_ATTEMPTS` times; one denied for good raises as itself.
    """
    if pixel_provider is not None:
        from zmart_interface.parts.microscope.simulator_guard import assert_simulator

        assert_simulator(record.get("vendor_metadata") or [], record["position_label"])
    for attempt in range(WRITE_ATTEMPTS):
        try:
            return _write_a_position(record, into, format=format, pixel_provider=pixel_provider)
        except PermissionError as denied:
            if attempt == WRITE_ATTEMPTS - 1:
                raise
            time.sleep(WRITE_RETRY_S * (attempt + 1))
            last = denied
    raise last  # pragma: no cover -- the loop above always returns or raises


def frame_um_of(position: Path | str) -> float:
    """How wide one position is on the sample, in micrometres: its full-size
    width times the pixel size the writer recorded. The position is the
    capture's own word on its size, where a recording made before the run is
    only what was promised."""
    width_px, pixel_um = _the_geometry_of(Path(position))
    return float(width_px * pixel_um)


def pixel_size_um_of(position: Path | str) -> float:
    """The width of one full-size pixel of a position, in micrometres.

    Raises ``RuntimeError`` when the position does not say.
    """
    return float(_the_geometry_of(Path(position))[1])


def name_of_a_position(kind: str, label: str, format: str) -> str:
    """What a position is called: ``overview_P000001.ome.tif``, say."""
    return f"{kind}_{label}{ENDINGS[format]}"


def is_a_position_name(name: str) -> bool:
    """Whether a name is that of a position, in either format."""
    return name.endswith(ENDINGS["ome-zarr"]) or name.lower().endswith(_TIFF_ENDINGS)


def format_of(path: Path | str) -> str | None:
    """The format a finished position is in, or None when ``path`` is not one.

    An OME-Zarr image is a folder. An OME-TIFF counts only when ZMART's note
    (:data:`ZMART_NOTE`) is inside it, because only then is its stage
    position known to be the corner of the picture: an OME-TIFF a microscope
    wrote one plane at a time says something else, or nothing.
    """
    path = Path(path)
    if path.name.endswith(ENDINGS["ome-zarr"]) and path.is_dir():
        return "ome-zarr"
    if path.name.lower().endswith(_TIFF_ENDINGS) and path.is_file():
        stat = path.stat()
        if _the_note_in(str(path), stat.st_mtime_ns, stat.st_size):
            return "ome-tiff"
    return None


def is_a_position(path: Path | str) -> bool:
    """Whether ``path`` is a finished position, in either format."""
    return format_of(path) is not None


def write_a_projection(position: Path | str, into: Path | str) -> Path:
    """Write the maximum projection over z of an OME-TIFF position, and return it.

    The projection lands in ``into`` under the position's own name, as an
    OME-TIFF of one plane per channel, at the same place on the stage. It is
    what a person opens to see a stack at a glance, and what the viewer
    shows as the run's projection. (For OME-Zarr runs the viewer makes its
    projections itself.)
    """
    import tifffile

    position = Path(position)
    into = Path(into)
    into.mkdir(parents=True, exist_ok=True)
    with tifffile.TiffFile(position) as tif:
        series = tif.series[0]
        held = series.asarray()
        axes = series.axes
        root = ElementTree.fromstring(tif.ome_metadata)
    volume = _in_five_axes(held, axes)
    pixels = _the_first(root, "Pixels")
    voxel_um = tuple(_length_um(pixels, f"PhysicalSize{axis}") or 1.0 for axis in "ZYX")
    plane = _the_first(pixels, "Plane")
    corner_um = tuple(_length_um(plane, f"Position{axis}") or 0.0 for axis in "ZYX")
    channel_blocks = [
        {"label": channel.get("Name") or f"channel {index}", "color": _hex_of(channel.get("Color"))}
        for index, channel in enumerate(one for one in pixels if one.tag.endswith("}Channel"))
    ]
    return _write_a_tiff(
        into / position.name,
        volume.max(axis=2, keepdims=True),
        voxel_um=voxel_um,
        corner_um=corner_um,
        channel_blocks=channel_blocks,
        zmart_microscopy=None,
    )


def _write_a_position(record: dict, into: Path | str, *, format: str, pixel_provider=None) -> Path:
    """One attempt at :func:`position_from_record`."""
    planes = record.get("planes") or []
    if not planes:
        raise RuntimeError("the capture reported no planes, so there is nothing to keep")

    z_model = _the_z_model(record, planes)
    volume, pixel_size_um = _the_volume_of(
        planes, depth_order=z_model["array_order"], pixel_provider=pixel_provider,
    )
    frames, channels, nz, ny, nx = volume.shape
    dz = z_model["spacing_um"]
    corner_um = _the_corner_of(
        planes, (ny, nx), pixel_size_um, z_origin_um=z_model["lowest_plane_um"],
    )

    into = Path(into)
    into.mkdir(parents=True, exist_ok=True)
    # The store's name leads with the acquisition type, the way the run
    # writers name theirs (``overview_pos00000.ome.zarr``): the viewer reads
    # which stores belong together off the names, and a store named only by
    # its position would stand under a heading of its own. The type is the
    # interface's own, stamped on the record by the bridge from what it asked
    # for; drivers do not report it.
    kind = record.get("acquisition_type") or "capture"
    published = into / name_of_a_position(kind, record["position_label"], format)
    depth_max = _the_depth_of(volume.dtype)
    # Each channel opens on a window measured from its own pixels — the
    # pixels are already in hand, so this costs nothing. Declaring the
    # camera's whole range instead is honest but useless on screen: a
    # real acquisition sits in the bottom few per cent of it, and the
    # picture opened very nearly black.
    channel_blocks = [
        Channel(
            f"channel {index}",
            window=_a_window_onto(volume[:, index], depth_max),
        ).described(depth_max)
        for index in range(channels)
    ]
    zmart_microscopy = {"z_coordinate": z_model}
    if pixel_provider is not None:
        zmart_microscopy["synthetic_pixels"] = pixel_provider.recipe
    if format == "ome-tiff":
        return _write_a_tiff(
            published,
            volume,
            voxel_um=(dz, pixel_size_um[0], pixel_size_um[1]),
            corner_um=corner_um,
            channel_blocks=channel_blocks,
            zmart_microscopy=zmart_microscopy,
        )
    # Written somewhere the viewer is not looking, and moved into place only
    # once every level is filled. The viewer watches ``positions/<type>`` and
    # shows a store the moment its description exists, so a store filled in
    # place was visible while its coarser copies were still empty: the
    # picture asked for a zoomed-out copy, was told there was none, and
    # showed a hole until it happened to ask again. Renaming a finished
    # folder is one step the file system does whole, so the viewer now sees
    # either nothing or the complete store, never something in between.
    store = _a_place_to_write(into, published.name)

    tile_shape = (nz, ny, nx)
    arrays = declare_image(
        store,
        canvas_shape=tile_shape,
        frames=frames,
        channels=channels,
        dtype=str(volume.dtype),
        chunk=PIECE,
        levels=how_many_copies_a_position_can_keep(tile_shape, PIECE),
        voxel_size_um=(dz, pixel_size_um[0], pixel_size_um[1]),
        origin_um=corner_um,
        channel_blocks=channel_blocks,
        ome_zarr_version="0.5",
    )
    description_path = store / "zarr.json"
    description = json.loads(description_path.read_text(encoding="utf-8"))
    description.setdefault("attributes", {})["zmart_microscopy"] = zmart_microscopy
    _describe_mean_pyramid(description)
    description_path.write_text(json.dumps(description, indent=2), encoding="utf-8")

    # Fill the levels from the finest down, keeping every second voxel along
    # y and x — the run stores' own convention, declared in their description.
    shrinking = volume
    for level, array in enumerate(arrays):
        if level:
            shrinking = _mean_downsample_yx(shrinking)
        array[:] = shrinking
    return _publish(store, published)


def _a_place_to_write(into: Path, name: str) -> Path:
    """A folder beside the acquisition's positions where a store can be built.

    It sits next to the watched folder rather than inside it, so nothing the
    viewer lists can ever be half-written. Its name says what it is, so a
    folder left behind by a crash is recognisable and safe to delete.

    Short, on purpose: Windows counts a path to 260 characters unless told
    otherwise, and a chunk file carries a 40-character suffix while zarr
    writes it. Under a staging folder named after the store, a fine
    focussing stack's chunk ran to 270 and the store was never written.
    The name the store is published under (*name*) is the only long one.
    """
    staging = into.parent / ".writing" / uuid.uuid4().hex[:8]
    staging.mkdir(parents=True, exist_ok=True)
    return staging / "store.zarr"


def _publish(built: Path, published: Path) -> Path:
    """Move a finished store into the watched folder, replacing an older one.

    A rerun writes the same position again. The old store is moved aside
    first and the new one moved in, two renames rather than a slow delete
    with the name missing in between; the old pixels are removed last.
    """
    retired = None
    if published.exists():
        retired = built.parent / f"{published.name}.retired-{uuid.uuid4().hex[:8]}"
        published.rename(retired)
    built.rename(published)
    if retired is not None:
        shutil.rmtree(retired, ignore_errors=True)
    for staging in (built.parent, built.parent.parent):
        try:
            staging.rmdir()  # only succeeds once nothing else is being written
        except OSError:
            pass
    return published


# -- reading what the vendor wrote ------------------------------------------


def _the_volume_of(
    planes: list[dict], depth_order: list[int] | None = None,
    *, pixel_provider=None,
) -> tuple[np.ndarray, tuple[float, float]]:
    """The capture as one ``(t, c, z, y, x)`` array, and its (y, x) µm/voxel.

    The vendor may have written one file per plane or one file for the whole
    capture — the record's plane entries say which slot each file (or slice of
    a file) fills, so both arrive the same way here.

    ``depth_order`` is the vendor's z numbers in the order the array should
    hold them — ascending stage z, as :func:`_the_z_model` decides. Without
    it the vendor's own numbering is kept.
    """
    import tifffile

    files: dict[str, tifffile.TiffFile] = {}
    try:
        for plane in planes:
            path = str(plane["path"])
            if path not in files:
                files[path] = tifffile.TiffFile(path)

        first = files[str(planes[0]["path"])]
        pixel_size_um = _the_pixel_size_of(first.ome_metadata or "")

        # The vendor's own numbering is packed down to 0..n-1 per axis: a
        # Leica job numbers its channels from 1, and taking the numbers as
        # array indices left channel 0 an empty black plane.
        frames = _packed(planes, "t")
        channels = _packed(planes, "c")
        depth = (
            {number: index for index, number in enumerate(depth_order)}
            if depth_order is not None else _packed(planes, "z")
        )
        slots = {tuple(int(p.get(axis, 0)) for axis in ("t", "c", "z")) for p in planes}
        if len(slots) != len(planes) or len(slots) != len(frames) * len(channels) * len(depth):
            raise ValueError("A completed position requires exactly one saved plane per T/C/Z slot")

        volume: np.ndarray | None = None
        for plane in planes:
            held = files[str(plane["path"])]
            image = _one_plane_of(held, plane)
            if pixel_provider is not None:
                replacement = pixel_provider(image.shape, image.dtype, plane=plane, pixel_um=pixel_size_um)
                if replacement.shape != image.shape or replacement.dtype != image.dtype:
                    raise ValueError("Synthetic pixels must preserve the saved plane's shape and dtype")
                image = replacement
            if volume is None:
                volume = np.zeros(
                    (len(frames), len(channels), len(depth), *image.shape),
                    dtype=image.dtype,
                )
            volume[
                frames[int(plane.get("t", 0))],
                channels[int(plane.get("c", 0))],
                depth[int(plane.get("z", 0))],
            ] = image
        assert volume is not None  # planes was checked non-empty above
        return volume, pixel_size_um
    finally:
        for held in files.values():
            held.close()


def _packed(planes: list[dict], axis: str) -> dict[int, int]:
    """The vendor's numbers along one axis, packed down to 0..n-1 in order."""
    seen = sorted({int(p.get(axis, 0)) for p in planes})
    return {number: index for index, number in enumerate(seen)}


def _one_plane_of(held, plane: dict) -> np.ndarray:
    """One y/x image out of a vendor file, whichever axes the file declares."""
    series = held.series[0]
    axes = series.axes.upper()
    data = series.asarray()
    if axes == "YX":
        return data
    # Everything before the trailing YX is indexed by the record's own
    # numbers; an axis the record does not speak of would be silently
    # mis-sliced, so it is refused by name instead.
    if not axes.endswith("YX"):
        raise RuntimeError(f"the vendor file's axes are {axes!r}, which do not end in YX")
    taken = {"T": int(plane.get("t", 0)), "C": int(plane.get("c", 0)), "Z": int(plane.get("z", 0))}
    index = []
    for axis in axes[:-2]:
        if axis not in taken:
            raise RuntimeError(
                f"the vendor file declares a {axis!r} axis the record says nothing about"
            )
        index.append(taken[axis])
    return data[tuple(index)]


def _the_pixel_size_of(ome_xml: str) -> tuple[float, float]:
    """The (y, x) µm per voxel, read from the vendor's own OME description.

    A file that says nothing gets 1 µm — honest enough to draw, and plainly
    wrong enough to notice — rather than a refusal that would cost the pixels.
    """

    def one(name: str) -> float:
        size = re.search(rf'PhysicalSize{name}="([^"]+)"', ome_xml)
        if not size:
            return 1.0
        unit = re.search(rf'PhysicalSize{name}Unit="([^"]+)"', ome_xml)
        return float(size.group(1)) * _TO_UM.get(unit.group(1) if unit else "", 1.0)

    return one("Y"), one("X")


def _the_z_model(record: dict, planes: list[dict]) -> dict:
    """Where the capture stands in z, in specimen space.

    Every store is placed in specimen coordinates in all three axes -- the
    frame the driver drives in, x and y from the origin on the carrier and z
    the height above the coverslip face, physical up on every stand:
    ``scale`` is the size of a voxel and is always positive, and
    ``translation`` is where the first voxel sits, positive or negative as
    the stamps say. A flat capture retains its measured height; placing it
    on a shared display plane belongs to the viewer aggregate.
    A stack is written **ascending**: its lowest plane first, and the rest above it at
    the spacing it was acquired with. Which way the drive swept is not the
    store's business: a downward sweep is reversed on the way in, and the
    two stores that result are
    indistinguishable. The sweep as it happened is kept beside, as
    provenance, for anyone who wants the story rather than the picture.

    Why not keep the sign: a negative ``scale`` is not an OME-Zarr transform.
    neuroglancer refuses it outright ("Expected positive finite
    floating-point number"), and one refused layer nulls the scene's shared
    depth, which blanked a perfectly good overview beside it.

    Returns the array order (vendor z numbers, ascending specimen z), the
    positive spacing, the lowest plane's specimen z, and the provenance.
    """
    numbered = sorted({int(plane.get("z", 0)) for plane in planes})
    centres: list[float | None] = []
    for number in numbered:
        found = [
            float(plane["z_um"])
            for plane in planes
            if int(plane.get("z", 0)) == number
            and plane.get("z_um") is not None
            and math.isfinite(float(plane["z_um"]))
        ]
        centres.append(float(np.median(found)) if found else None)

    requested = record.get("requested_position_um") or record.get("position") or {}
    requested_z = requested.get("z") if isinstance(requested, dict) else None
    if requested_z is not None:
        requested_z = float(requested_z)
        if not math.isfinite(requested_z):
            requested_z = None

    known = [(centre, number) for centre, number in zip(centres, numbered, strict=True) if centre is not None]
    if not known and len(numbered) > 1:
        # A stack with no height on any plane has no stage z to stand at and
        # no spacing: a store made up for it would stand at z 0, one
        # micrometre a plane, and draw as if that were true.
        raise RuntimeError(
            "the capture's planes report no stage z, so the stack cannot be placed"
        )
    if known:
        # Ascending stage z; a plane whose height is unknown keeps its vendor
        # place after the known ones, so nothing is invented for it.
        ascending = [number for _centre, number in sorted(known)]
        ascending += [number for centre, number in zip(centres, numbered, strict=True) if centre is None]
        heights = sorted(centre for centre, _number in known)
        lowest = heights[0]
    else:
        # One flat plane with no height: the requested focus is the only
        # account there is of where it was taken, and the stage origin
        # failing that.
        ascending = list(numbered)
        heights = []
        lowest = requested_z if requested_z is not None else 0.0

    steps = [b - a for a, b in zip(heights, heights[1:], strict=False)]
    spacing = abs(float(np.median(steps))) if steps else 1.0
    if not math.isfinite(spacing) or spacing == 0:
        spacing = 1.0

    if len(numbered) == 1:
        sweep = "single-plane"
    elif len(known) < 2:
        sweep = "unknown"
    else:
        first, last = known[0][0], known[-1][0]
        sweep = "increasing" if last >= first else "decreasing"

    return {
        "model": "zmart-microscopy-specimen-z-v1",
        "frame": "specimen",
        "array_order": ascending,
        "spacing_um": spacing,
        "lowest_plane_um": float(lowest),
        "unit": "micrometer",
        "acquisition_provenance": {
            "plane_order_as_acquired": numbered,
            "plane_centres_um": centres,
            "sweep_direction": sweep,
            "requested_stage_focus_z_um": requested_z,
            "unit": "micrometer",
        },
    }


def _the_corner_of(
    planes: list[dict],
    frame_yx: tuple[int, int],
    pixel_size_um: tuple[float, float],
    *,
    z_origin_um: float,
) -> tuple[float, float, float]:
    """Where the store's first voxel sits on the stage, in (z, y, x) µm.

    The record's stage point is the centre of the frame; the store's
    convention is the corner of the first voxel along the sample.

    The z origin was decided once by :func:`_the_z_model`: the specimen z
    of the lowest plane, so a store's z is the specimen's like its x and y.
    A plane that does not say where it was taken is refused: placed at the
    stage's zero, it showed in the corner of the canvas as if taken there.
    """
    for axis in ("x_um", "y_um"):
        if planes[0].get(axis) is None:
            raise ValueError(
                f"the capture does not say where it was taken (its first plane has no {axis}), "
                "so it cannot be placed on the stage"
            )
    x_um = float(planes[0]["x_um"])
    y_um = float(planes[0]["y_um"])
    return (
        z_origin_um,
        y_um - frame_yx[0] * pixel_size_um[0] / 2.0,
        x_um - frame_yx[1] * pixel_size_um[1] / 2.0,
    )


def _a_window_onto(channel: np.ndarray, depth_max: int) -> tuple[int, int]:
    """The brightness range this channel should first be shown with.

    The darkest percentile to just past the brightest, so a stray hot pixel
    cannot stretch the window and flatten everything else. A channel with
    nothing in it (all one value) falls back to the camera's whole range —
    a degenerate window is refused by readers.
    """
    low, high = np.percentile(channel, [1.0, 99.9])
    low, high = int(low), int(np.ceil(high))
    if high <= low:
        return (0, depth_max)
    return (low, min(high, depth_max))


def _mean_downsample_yx(values: np.ndarray) -> np.ndarray:
    """Average adjacent 2 × 2 pixels while preserving the camera dtype."""
    height = (values.shape[-2] // 2) * 2
    width = (values.shape[-1] // 2) * 2
    blocks = values[..., :height, :width].reshape(
        *values.shape[:-2], height // 2, 2, width // 2, 2
    )
    averaged = blocks.mean(axis=(-3, -1), dtype=np.float32)
    if np.issubdtype(values.dtype, np.integer):
        averaged = np.rint(averaged)
    return averaged.astype(values.dtype, copy=False)


def _describe_mean_pyramid(description: dict) -> None:
    """Say truthfully how the position's reduced-resolution copies were made."""
    multiscales = description.get("attributes", {}).get("ome", {}).get("multiscales", [])
    for multiscale in multiscales:
        multiscale["type"] = "mean"
        multiscale["metadata"] = {
            "description": "Each y/x level is the mean of adjacent 2 by 2 pixels.",
            "method": "2x2-mean",
        }


def _the_depth_of(dtype: np.dtype) -> int:
    """The brightest value the dtype can hold, for the channel description."""
    try:
        return int(np.iinfo(dtype).max)
    except ValueError:
        return 65535


# -- OME-TIFF positions ---------------------------------------------------------


def _write_a_tiff(
    published: Path,
    volume: np.ndarray,
    *,
    voxel_um: tuple[float, float, float],
    corner_um: tuple[float, float, float],
    channel_blocks: list[dict],
    zmart_microscopy: dict | None,
) -> Path:
    """Write ``volume`` (t, c, z, y, x) as one OME-TIFF position at ``published``.

    The smaller copies are made and stored the same way as in an OME-Zarr
    position: as many as :func:`how_many_copies_a_position_can_keep` allows,
    each the mean of 2 × 2 pixels of the one before, kept inside the file as
    sub-images of each plane, which is where Fiji, QuPath and napari look for
    them. The file is written under a temporary name beside its place and
    moved there in one step, so the viewer never finds it half-written.
    """
    import tifffile

    frames, channels, depth, height, width = volume.shape
    levels = how_many_copies_a_position_can_keep((depth, height, width), PIECE)
    copies = [volume]
    for _ in range(levels - 1):
        copies.append(_mean_downsample_yx(copies[-1]))
    planes = [copy.reshape(-1, *copy.shape[-2:]) for copy in copies]
    described = _ome_xml(
        name=published.name,
        volume=volume,
        voxel_um=voxel_um,
        corner_um=corner_um,
        channel_blocks=channel_blocks,
        zmart_microscopy=zmart_microscopy,
    )
    options = {
        "tile": (PIECE, PIECE),
        "photometric": "minisblack",
        "compression": "zlib",
        "compressionargs": {"level": _DEFLATE_LEVEL},
        "metadata": None,
    }
    published.parent.mkdir(parents=True, exist_ok=True)
    staging = published.with_name(f".{published.name}.{uuid.uuid4().hex[:8]}.writing")
    try:
        # A classic TIFF cannot be larger than 4 GB; the larger kind can.
        with tifffile.TiffWriter(staging, bigtiff=volume.nbytes >= 2**31) as tif:
            for index, plane in enumerate(planes[0]):
                tif.write(
                    plane,
                    subifds=levels - 1,
                    description=described if index == 0 else None,
                    **options,
                )
                for smaller in planes[1:]:
                    tif.write(smaller[index], subfiletype=1, **options)
        os.replace(staging, published)
    finally:
        staging.unlink(missing_ok=True)
    return published


def _ome_xml(
    *,
    name: str,
    volume: np.ndarray,
    voxel_um: tuple[float, float, float],
    corner_um: tuple[float, float, float],
    channel_blocks: list[dict],
    zmart_microscopy: dict | None,
) -> bytes:
    """The OME-XML description of one position, with ZMART's note in it.

    Planes are stored with z changing fastest, then the channel, then time
    (``DimensionOrder="XYZCT"``). Every plane records the stage position of
    the picture's corner; the planes of a stack differ only in z.
    """
    frames, channels, depth, height, width = volume.shape
    kind = {"float32": "float", "float64": "double"}.get(volume.dtype.name, volume.dtype.name)
    dz, dy, dx = voxel_um
    z0, y0, x0 = corner_um
    channel_elements = "".join(
        f'<Channel ID="Channel:0:{index}" Name={quoteattr(str(block.get("label") or ""))}'
        + (f' Color="{_ome_colour_of(block["color"])}"' if block.get("color") else "")
        + ' SamplesPerPixel="1"/>'
        for index, block in enumerate(channel_blocks)
    )
    plane_elements = "".join(
        f'<Plane TheT="{t}" TheC="{c}" TheZ="{z}" '
        f'PositionX="{x0}" PositionXUnit="µm" PositionY="{y0}" PositionYUnit="µm" '
        f'PositionZ="{z0 + z * dz}" PositionZUnit="µm"/>'
        for t in range(frames)
        for c in range(channels)
        for z in range(depth)
    )
    note = {"pyramid": "mean", "position_origin": "corner"}
    if zmart_microscopy is not None:
        note["zmart_microscopy"] = json.dumps(zmart_microscopy, sort_keys=True)
    entries = "".join(f"<M K={quoteattr(key)}>{escape(value)}</M>" for key, value in note.items())
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06" Creator="ZMART interface">'
        f'<Image ID="Image:0" Name={quoteattr(name)}>'
        f'<Pixels ID="Pixels:0" DimensionOrder="XYZCT" Type="{kind}" '
        f'SizeX="{width}" SizeY="{height}" SizeZ="{depth}" SizeC="{channels}" SizeT="{frames}" '
        f'PhysicalSizeX="{dx}" PhysicalSizeXUnit="µm" PhysicalSizeY="{dy}" PhysicalSizeYUnit="µm" '
        f'PhysicalSizeZ="{dz}" PhysicalSizeZUnit="µm">'
        f"{channel_elements}"
        f'<TiffData PlaneCount="{frames * channels * depth}"/>'
        f"{plane_elements}"
        "</Pixels>"
        '<AnnotationRef ID="Annotation:0"/>'
        "</Image>"
        f'<StructuredAnnotations><MapAnnotation ID="Annotation:0" Namespace="{ZMART_NOTE}">'
        f"<Value>{entries}</Value></MapAnnotation></StructuredAnnotations>"
        "</OME>"
    ).encode()


def _the_geometry_of(position: Path) -> tuple[int, float]:
    """A position's full-size width in pixels and its pixel width in micrometres."""
    if position.name.lower().endswith(_TIFF_ENDINGS):
        import tifffile

        with tifffile.TiffFile(position) as tif:
            pixels = _the_first(ElementTree.fromstring(tif.ome_metadata or "<OME/>"), "Pixels")
        size = _length_um(pixels, "PhysicalSizeX")
        if pixels is None or size is None:
            raise RuntimeError(f"{position} declares no pixel size")
        return int(pixels.get("SizeX")), size

    import zarr  # noqa: PLC0415

    opened = zarr.open(str(position), mode="r")
    attributes = dict(opened.attrs)
    multiscale = ((attributes.get("ome") or attributes).get("multiscales") or [{}])[0]
    axes = [axis.get("name") for axis in multiscale.get("axes", [])]
    width_px = opened[multiscale["datasets"][0]["path"]].shape[-1]
    for transform in multiscale["datasets"][0].get("coordinateTransformations", []):
        if transform.get("type") == "scale":
            return width_px, float(transform["scale"][axes.index("x") if "x" in axes else -1])
    raise RuntimeError(f"{position} declares no pixel size")


@lru_cache(maxsize=4096)
def _the_note_in(path: str, written_ns: int, size: int) -> dict:
    """ZMART's note inside an OME-TIFF, or an empty one. Remembered while the
    file is unchanged: the time it was written and its size are part of the key."""
    import tifffile

    del written_ns, size  # only part of the key
    try:
        with tifffile.TiffFile(path) as tif:
            root = ElementTree.fromstring(tif.ome_metadata or "<OME/>")
    except (OSError, ValueError, ElementTree.ParseError, tifffile.TiffFileError):
        return {}
    for note in root.iter():
        if note.tag.endswith("}MapAnnotation") and note.get("Namespace") == ZMART_NOTE:
            return {entry.get("K"): entry.text or "" for entry in note.iter() if entry.tag.endswith("}M")}
    return {}


def _in_five_axes(held: np.ndarray, axes: str) -> np.ndarray:
    """An array in the file's own axis order, given as (t, c, z, y, x)."""
    order = [axes.index(axis) for axis in "TCZYX" if axis in axes]
    held = np.transpose(held, order)
    present = [axis for axis in "TCZYX" if axis in axes]
    return held.reshape([held.shape[present.index(axis)] if axis in present else 1 for axis in "TCZYX"])


def _the_first(parent, name: str):
    """The first element called ``name`` inside ``parent``, whatever its namespace."""
    if parent is None:
        return None
    return next((one for one in parent.iter() if one.tag.endswith("}" + name)), None)


def _length_um(element, attribute: str) -> float | None:
    """A length an OME element gives, such as ``PhysicalSizeX``, in micrometres."""
    if element is None or element.get(attribute) is None:
        return None
    unit = element.get(f"{attribute}Unit", "µm")
    return float(element.get(attribute)) * _TO_UM.get(unit, 1.0)


def _ome_colour_of(hex_colour: str) -> int:
    """``RRGGBB`` as OME-XML writes a colour: one signed number holding red, green, blue and alpha."""
    value = int(hex_colour.lstrip("#")[:6], 16) << 8 | 0xFF
    return value - (1 << 32) if value >= 1 << 31 else value


def _hex_of(ome_colour: str | None) -> str | None:
    """The reverse of :func:`_ome_colour_of`, or None when the file names no colour."""
    if ome_colour is None:
        return None
    value = int(ome_colour) & 0xFFFFFFFF
    return f"{value >> 8:06X}"
