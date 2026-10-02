"""Small, workflow-owned output layout helpers.

The workflow owns experiment/acquisition folders.  Drivers own image
filenames and return the files they saved; this module only moves those files,
without renaming them, into the acquisition's ``data`` folder.
"""

from __future__ import annotations

import re
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_NAME_RE = re.compile(r"^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$")
_HASH_RE = re.compile(r"^[0-9a-z]{6}$")
_CREATE_ATTEMPTS = 16


@dataclass(frozen=True)
class AcquisitionOutput:
    """One workflow acquisition-type directory."""

    root: Path
    data: Path


def _validate_name(value: str, *, field: str) -> str:
    if not isinstance(value, str) or not _NAME_RE.fullmatch(value):
        raise ValueError(
            f"{field} must contain only letters/digits separated by '-' or '_', got {value!r}"
        )
    return value


def _validate_hash(value: str) -> str:
    if not isinstance(value, str) or not _HASH_RE.fullmatch(value):
        raise ValueError(f"hash6 must be exactly 6 lowercase base36 characters, got {value!r}")
    return value


def _new_hash() -> str:
    return uuid.uuid4().hex[:6]


def _create_hashed_dir(parent: Path, name: str, hash6: str | None) -> tuple[str, Path]:
    parent.mkdir(parents=True, exist_ok=True)
    if hash6 is not None:
        value = _validate_hash(hash6)
        path = parent / f"{name}_{value}"
        path.mkdir(parents=False, exist_ok=False)
        return value, path

    for _ in range(_CREATE_ATTEMPTS):
        value = _new_hash()
        path = parent / f"{name}_{value}"
        try:
            path.mkdir(parents=False, exist_ok=False)
        except FileExistsError:
            continue
        return value, path
    raise RuntimeError(f"could not allocate a unique output directory for {name!r} under {parent}")


def prepare_experiment(output_root: Any, experiment: str, *, hash6: str | None = None) -> Path:
    """Create and return ``<output_root>/<experiment>_<hash6>``."""

    name = _validate_name(experiment, field="experiment")
    _hash, path = _create_hashed_dir(Path(output_root).expanduser().resolve(), name, hash6)
    return path


def prepare_acquisition(
    experiment_root: Any,
    acquisition_type: str,
) -> AcquisitionOutput:
    """Create ``<experiment>/<acquisition_type>/data``."""

    name = _validate_name(acquisition_type, field="acquisition_type")
    root = Path(experiment_root) / name
    root.mkdir(parents=True, exist_ok=True)
    data = root / "data"
    data.mkdir(exist_ok=True)
    return AcquisitionOutput(root=root, data=data)


def position_label(
    position: int,
    *,
    carrier: int = 0,
    compartment: int = 0,
    group: int = 0,
    view: int = 0,
) -> str:
    """Return the canonical workflow location label (time/channel/z are planes)."""

    fields = {
        "carrier": (carrier, 2),
        "compartment": (compartment, 6),
        "group": (group, 6),
        "position": (position, 6),
        "view": (view, 2),
    }
    for name, (value, width) in fields.items():
        if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value < 10**width:
            raise ValueError(f"{name} must be a whole number from 0 through {10**width - 1}")
    return f"K{carrier:02d}_M{compartment:06d}_G{group:06d}_P{position:06d}_V{view:02d}"


def move_record_images(record: dict, data_dir: Any) -> dict:
    """Move every file a capture saved into the run, unchanged, and update the record's paths.

    ``files`` is where the driver lists every file it saved, the name the
    ZMART Controller's contract fixes so the interface finds the pictures on
    any microscope. Each file lands in *data_dir* under its own name, except
    two kinds of description that sit beside the images: the state the driver
    printed (named under ``metadata``) goes to ``data_dir/metadata/ZMART_state``,
    and the microscope software's own metadata (named under
    ``vendor_metadata``) to ``data_dir/metadata/vendor``. Every file a plane
    or a description names must be one of the files, so that the record can
    never disagree with itself about what was saved.

    Every source and destination is checked before the first move. If a later
    move fails, the files already moved go back where they were, so one
    capture is never left half in staging and half in the run.
    """

    files = record.get("files")
    if not isinstance(files, list) or not files:
        raise RuntimeError(
            "the acquisition listed no files: a driver must name every file it saved under 'files'"
        )
    sources = list(dict.fromkeys(Path(value) for value in files))
    named = [plane["path"] for plane in record.get("planes", [])]
    named += [*record.get("metadata", []), *record.get("vendor_metadata", [])]
    unlisted = [value for value in named if Path(value) not in sources]
    if unlisted:
        raise RuntimeError(f"the capture names {unlisted}, not among the files it saved")

    destination = Path(data_dir)
    beside = {
        **{Path(value): destination / "metadata" / "vendor" for value in record.get("vendor_metadata", [])},
        **{Path(value): destination / "metadata" / "ZMART_state" for value in record.get("metadata", [])},
    }
    moves = [(source, beside.get(source, destination) / source.name) for source in sources]
    targets = [target for _, target in moves]
    if len(targets) != len(set(targets)):
        raise RuntimeError("acquire returned different files with the same filename")
    for source, target in moves:
        if not source.exists():
            raise FileNotFoundError(f"acquired file does not exist: {source}")
        if target.exists():
            raise FileExistsError(f"refusing to replace an existing acquisition file: {target}")

    moved: list[tuple[Path, Path]] = []
    try:
        for source, target in moves:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(source), str(target))
            moved.append((source, target))
    except Exception:
        for source, target in reversed(moved):
            if target.exists() and not source.exists():
                source.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(target), str(source))
        raise

    mapped = {source: str(target) for source, target in moves}
    record["files"] = [mapped[source] for source in sources]
    for plane in record.get("planes", []):
        plane["path"] = mapped[Path(plane["path"])]
    for key in ("metadata", "vendor_metadata"):
        if record.get(key):
            record[key] = [mapped[Path(value)] for value in record[key]]
    return record
