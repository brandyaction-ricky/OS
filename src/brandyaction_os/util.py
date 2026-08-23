from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable
from zoneinfo import ZoneInfo


def now_iso(timezone_name: str = "Asia/Seoul") -> str:
    return datetime.now(ZoneInfo(timezone_name)).isoformat(timespec="seconds")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
    finally:
        if temporary_path.exists():
            temporary_path.unlink()


def atomic_write_json(path: Path, value: Any) -> None:
    atomic_write_text(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"JSON root must be an object: {path}")
    return value


def actor_slug(actor: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9._-]+", "-", actor.strip()).strip("-").lower()
    return value or "ba-user"


def format_table(headers: list[str], rows: Iterable[Iterable[Any]]) -> str:
    normalized = [[str(cell) if cell is not None else "-" for cell in row] for row in rows]
    widths = [display_width(header) for header in headers]
    for row in normalized:
        for index, cell in enumerate(row):
            widths[index] = max(widths[index], display_width(cell))

    def render_row(row: list[str]) -> str:
        return "  ".join(pad_display(cell, widths[index]) for index, cell in enumerate(row))

    return "\n".join([render_row(headers), render_row(["-" * width for width in widths]), *map(render_row, normalized)])


def display_width(value: str) -> int:
    return sum(2 if ord(char) > 0xFF else 1 for char in value)


def pad_display(value: str, width: int) -> str:
    return value + " " * max(0, width - display_width(value))
