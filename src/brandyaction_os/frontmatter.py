from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from .errors import BAError
from .util import atomic_write_text


class FrontmatterLoader(yaml.SafeLoader):
    """Safe YAML loader that keeps ISO timestamps as strings."""


FrontmatterLoader.yaml_implicit_resolvers = {
    key: [
        resolver
        for resolver in value
        if resolver[0] != "tag:yaml.org,2002:timestamp"
    ]
    for key, value in yaml.SafeLoader.yaml_implicit_resolvers.items()
}


@dataclass(slots=True)
class MarkdownDocument:
    path: Path
    metadata: dict[str, Any]
    body: str


VERSIONED_FILE_PATTERN = re.compile(
    r"^(?P<key>[a-z0-9_]+)_v(?P<version>[1-9][0-9]*)\.md$"
)


def read_document(path: Path) -> MarkdownDocument:
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise BAError("E_FILE_NOT_FOUND", f"파일을 찾을 수 없습니다: {path}") from exc
    except UnicodeDecodeError as exc:
        raise BAError("E_ENCODING", f"UTF-8 Markdown이 아닙니다: {path}") from exc

    lines = text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        raise BAError(
            "E_FRONTMATTER_MISSING",
            f"Frontmatter 시작 구분자가 없습니다: {path}",
        )

    closing_index: int | None = None
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            closing_index = index
            break
    if closing_index is None:
        raise BAError(
            "E_FRONTMATTER_UNCLOSED",
            f"Frontmatter 종료 구분자가 없습니다: {path}",
        )

    yaml_text = "".join(lines[1:closing_index])
    try:
        metadata = yaml.load(yaml_text, Loader=FrontmatterLoader) or {}
    except yaml.YAMLError as exc:
        raise BAError(
            "E_FRONTMATTER_YAML",
            f"Frontmatter YAML을 읽을 수 없습니다: {path}: {exc}",
        ) from exc
    if not isinstance(metadata, dict):
        raise BAError(
            "E_FRONTMATTER_TYPE",
            f"Frontmatter 최상위 값은 객체여야 합니다: {path}",
        )

    return MarkdownDocument(
        path=path,
        metadata=metadata,
        body="".join(lines[closing_index + 1 :]),
    )


def serialize_document(metadata: dict[str, Any], body: str) -> str:
    yaml_text = yaml.safe_dump(
        metadata,
        allow_unicode=True,
        default_flow_style=False,
        sort_keys=False,
        width=120,
    )
    normalized_body = body.lstrip("\n")
    if normalized_body and not normalized_body.endswith("\n"):
        normalized_body += "\n"
    return f"---\n{yaml_text}---\n\n{normalized_body}"


def write_document(path: Path, metadata: dict[str, Any], body: str) -> None:
    atomic_write_text(path, serialize_document(metadata, body))


def parse_versioned_filename(path: Path) -> tuple[str, int] | None:
    match = VERSIONED_FILE_PATTERN.fullmatch(path.name)
    if not match:
        return None
    return match.group("key"), int(match.group("version"))

