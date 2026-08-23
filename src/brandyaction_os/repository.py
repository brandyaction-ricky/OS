from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from .errors import BAError
from .frontmatter import MarkdownDocument, parse_versioned_filename, read_document
from .util import actor_slug, read_json, sha256_file


CONTENT_ID_PATTERN = re.compile(r"^BA-[0-9]{4}$")


@dataclass(slots=True)
class GitState:
    is_repository: bool
    head: str | None = None
    upstream_ref: str | None = None
    upstream_commit: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "is_repository": self.is_repository,
            "head": self.head,
            "upstream_ref": self.upstream_ref,
            "upstream_commit": self.upstream_commit,
        }


class Repository:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self._manifest: dict[str, Any] | None = None

    @classmethod
    def discover(cls, start: Path | None = None) -> "Repository":
        override = os.environ.get("BA_REPO_ROOT")
        current = Path(override).expanduser() if override else (start or Path.cwd())
        current = current.resolve()
        for candidate in (current, *current.parents):
            if (
                (candidate / "manifest.json").is_file()
                and (candidate / "00_system").is_dir()
                and (candidate / "05_contents").is_dir()
            ):
                return cls(candidate)
        raise BAError(
            "E_REPO_NOT_FOUND",
            "BrandyAction OS 저장소를 찾을 수 없습니다.",
            hint="저장소 내부에서 실행하거나 BA_REPO_ROOT를 지정하세요.",
        )

    @property
    def manifest(self) -> dict[str, Any]:
        if self._manifest is None:
            try:
                self._manifest = read_json(self.root / "manifest.json")
            except (OSError, ValueError, json.JSONDecodeError) as exc:
                raise BAError(
                    "E_MANIFEST_INVALID",
                    f"manifest.json을 읽을 수 없습니다: {exc}",
                ) from exc
        return self._manifest

    @property
    def workspace_root(self) -> Path:
        value = str(self.manifest.get("workspace_dir", ".workspace"))
        return self.root / value

    def workspace_path(self, content_id: str) -> Path:
        self.validate_content_id(content_id)
        return self.workspace_root / content_id

    @property
    def contents_root(self) -> Path:
        return self.root / "05_contents"

    def validate_content_id(self, content_id: str) -> None:
        if not CONTENT_ID_PATTERN.fullmatch(content_id):
            raise BAError(
                "E_CONTENT_ID",
                f"올바르지 않은 Content ID입니다: {content_id}",
                hint="BA-0001 형식을 사용하세요.",
            )

    def content_dir(self, content_id: str) -> Path:
        self.validate_content_id(content_id)
        path = self.contents_root / content_id
        if not path.is_dir():
            raise BAError("E_CONTENT_NOT_FOUND", f"Content Run이 없습니다: {content_id}")
        return path

    def content_path(self, content_id: str) -> Path:
        path = self.content_dir(content_id) / "CONTENT.md"
        if not path.is_file():
            raise BAError("E_CONTENT_FILE", f"CONTENT.md가 없습니다: {content_id}")
        return path

    def content_document(self, content_id: str) -> MarkdownDocument:
        return read_document(self.content_path(content_id))

    def content_ids(self) -> list[str]:
        if not self.contents_root.exists():
            return []
        return sorted(
            path.name
            for path in self.contents_root.iterdir()
            if path.is_dir() and CONTENT_ID_PATTERN.fullmatch(path.name)
        )

    def process_document(self, process_id: str) -> MarkdownDocument:
        path = self.root / "03_processes" / process_id / "PROCESS.md"
        if not path.is_file():
            raise BAError("E_PROCESS_NOT_FOUND", f"공정 정의가 없습니다: {process_id}")
        return read_document(path)

    def process_steps(self, process_id: str) -> list[dict[str, Any]]:
        metadata = self.process_document(process_id).metadata
        steps = metadata.get("steps")
        if not isinstance(steps, list) or not steps:
            raise BAError(
                "E_PROCESS_INVALID",
                f"공정 단계 정의가 비어 있습니다: {process_id}",
            )
        if not all(isinstance(step, dict) for step in steps):
            raise BAError(
                "E_PROCESS_INVALID",
                f"공정 단계는 객체 목록이어야 합니다: {process_id}",
            )
        return sorted(steps, key=lambda step: int(step.get("order", 0)))

    def process_step(self, process_id: str, step_id: str) -> dict[str, Any]:
        for step in self.process_steps(process_id):
            if step.get("id") == step_id:
                return step
        raise BAError(
            "E_STEP_NOT_FOUND",
            f"{process_id} 공정에 '{step_id}' 단계가 없습니다.",
        )

    def next_step(self, process_id: str, step: dict[str, Any]) -> dict[str, Any] | None:
        next_step_id = step.get("next_step")
        if next_step_id is None:
            return None
        return self.process_step(process_id, str(next_step_id))

    def skill_document(self, skill_id: str) -> MarkdownDocument:
        path = self.root / "04_skills" / skill_id / "SKILL.md"
        if not path.is_file():
            raise BAError("E_SKILL_NOT_FOUND", f"Skill이 없습니다: {skill_id}")
        return read_document(path)

    def skill_dir(self, skill_id: str) -> Path:
        document = self.skill_document(skill_id)
        return document.path.parent

    def step_dir(self, content_id: str, step: dict[str, Any]) -> Path:
        folder = step.get("folder")
        if not isinstance(folder, str) or not folder:
            raise BAError("E_PROCESS_INVALID", "Step의 folder 값이 없습니다.")
        return self.content_dir(content_id) / folder

    def resolve_content_pointer(self, content_id: str, pointer: str) -> Path:
        content_root = self.content_dir(content_id).resolve()
        candidate = (content_root / pointer).resolve()
        if not candidate.is_relative_to(content_root):
            raise BAError(
                "E_POINTER_ESCAPE",
                f"Content Run 밖을 가리키는 포인터입니다: {pointer}",
            )
        if not candidate.is_file():
            raise BAError(
                "E_POINTER_MISSING",
                f"포인터 대상 파일이 없습니다: {content_id}/{pointer}",
            )
        return candidate

    def context_files(self, content_metadata: dict[str, Any]) -> dict[str, list[Path]]:
        paths = self.manifest.get("context_paths", {})
        result: dict[str, list[Path]] = {"company": [], "brand": []}
        company_path = paths.get("company") if isinstance(paths, dict) else None
        if isinstance(company_path, str):
            root = self.root / company_path
            if root.is_dir():
                result["company"] = sorted(root.glob("*.md"))

        brand_id = content_metadata.get("brand_id")
        brand_pattern = paths.get("brand") if isinstance(paths, dict) else None
        if isinstance(brand_id, str) and isinstance(brand_pattern, str):
            root = self.root / brand_pattern.format(brand_id=brand_id)
            if root.is_dir():
                result["brand"] = sorted(root.glob("*.md"))
        return result

    def latest_version(self, content_id: str, step: dict[str, Any], key: str) -> int:
        maximum = 0
        folder = self.step_dir(content_id, step)
        if not folder.exists():
            return maximum
        for path in folder.glob(f"{key}_v*.md"):
            parsed = parse_versioned_filename(path)
            if parsed and parsed[0] == key:
                maximum = max(maximum, parsed[1])
        return maximum

    def versioned_artifacts(
        self, content_id: str, step: dict[str, Any], key: str
    ) -> list[Path]:
        folder = self.step_dir(content_id, step)
        result: list[tuple[int, Path]] = []
        if folder.exists():
            for path in folder.glob(f"{key}_v*.md"):
                parsed = parse_versioned_filename(path)
                if parsed and parsed[0] == key:
                    result.append((parsed[1], path))
        return [path for _, path in sorted(result)]

    def snapshot(self, content_id: str, step: dict[str, Any]) -> dict[str, Any]:
        paths = [self.content_path(content_id)]
        step_dir = self.step_dir(content_id, step)
        if step_dir.exists():
            paths.extend(sorted(step_dir.rglob("*.md")))
        values = {
            path.relative_to(self.root).as_posix(): sha256_file(path)
            for path in sorted(set(paths))
        }
        return {
            "content_id": content_id,
            "step": step.get("id"),
            "files": values,
        }

    def snapshot_changed(
        self, content_id: str, step: dict[str, Any], base_snapshot: dict[str, Any]
    ) -> list[str]:
        current = self.snapshot(content_id, step)
        base_files = base_snapshot.get("files", {})
        current_files = current.get("files", {})
        if not isinstance(base_files, dict) or not isinstance(current_files, dict):
            return ["<invalid snapshot>"]
        return sorted(
            path
            for path in set(base_files) | set(current_files)
            if base_files.get(path) != current_files.get(path)
        )

    def git_state(self, *, refresh: bool = False) -> GitState:
        if self._git(["rev-parse", "--is-inside-work-tree"], check=False).returncode != 0:
            return GitState(is_repository=False)

        head = self._git_text(["rev-parse", "HEAD"])
        upstream_ref = self._git_text(
            ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]
        )
        if refresh and upstream_ref:
            remote_name = upstream_ref.split("/", 1)[0]
            result = self._git(["fetch", "--quiet", remote_name], check=False, timeout=60)
            if result.returncode != 0:
                raise BAError(
                    "E_REMOTE_CHECK_FAILED",
                    "Git 원격 최신 상태를 확인하지 못했습니다.",
                    hint="네트워크와 Git 권한을 확인하거나 의도적으로 로컬만 작업할 때 --offline을 사용하세요.",
                )
        upstream_commit = self._git_text(["rev-parse", "@{u}"]) if upstream_ref else None
        state = GitState(True, head, upstream_ref, upstream_commit)
        if head and upstream_commit:
            contains = self._git(
                ["merge-base", "--is-ancestor", upstream_commit, head],
                check=False,
            )
            if contains.returncode != 0:
                raise BAError(
                    "E_REPOSITORY_BEHIND",
                    "현재 OS 저장소가 Git 원격보다 뒤에 있거나 분기되었습니다.",
                    hint="저장소를 fast-forward 방식으로 최신화한 뒤 다시 실행하세요. 자동 병합은 수행하지 않습니다.",
                )
        return state

    def assert_remote_unchanged(
        self, base_git: dict[str, Any] | None, *, offline: bool
    ) -> GitState:
        current = self.git_state(refresh=not offline)
        if offline or not base_git:
            return current
        base_upstream = base_git.get("upstream_commit")
        if base_upstream != current.upstream_commit:
            raise BAError(
                "E_REMOTE_NEWER",
                "Pull 이후 Git 원격 상태가 변경되었습니다.",
                hint="현재 Workspace를 보존하고 새로 Pull한 뒤 변경 내용을 다시 반영하세요.",
            )
        return current

    def commit_paths(self, paths: Iterable[Path], message: str, actor: str) -> str | None:
        state = self.git_state(refresh=False)
        if not state.is_repository:
            return None
        relative_paths = sorted(
            {
                path.resolve().relative_to(self.root).as_posix()
                for path in paths
            }
        )
        if not relative_paths:
            return state.head
        self._git(["add", "--", *relative_paths])
        diff = self._git(
            ["diff", "--cached", "--quiet", "--", *relative_paths],
            check=False,
        )
        if diff.returncode == 0:
            return self._git_text(["rev-parse", "HEAD"])
        env = os.environ.copy()
        slug = actor_slug(actor)
        env.update(
            {
                "GIT_AUTHOR_NAME": actor,
                "GIT_AUTHOR_EMAIL": f"{slug}@brandyaction.local",
                "GIT_COMMITTER_NAME": actor,
                "GIT_COMMITTER_EMAIL": f"{slug}@brandyaction.local",
            }
        )
        result = self._git(
            ["commit", "-m", message, "--", *relative_paths],
            check=False,
            env=env,
        )
        if result.returncode != 0:
            raise BAError(
                "E_GIT_COMMIT",
                f"변경 파일은 저장했지만 Git commit에 실패했습니다: {result.stderr.strip()}",
                hint="Git 상태를 확인한 뒤 같은 명령을 다시 실행하세요.",
            )
        return self._git_text(["rev-parse", "HEAD"])

    def push_upstream(self, *, offline: bool) -> bool:
        state = self.git_state(refresh=False)
        if offline or not state.is_repository or not state.upstream_ref:
            return False
        result = self._git(["push", "--porcelain"], check=False, timeout=120)
        if result.returncode != 0:
            raise BAError(
                "E_GIT_PUSH",
                "변경 내용은 로컬 Git에 commit했지만 원격 push에 실패했습니다.",
                hint="원격 권한과 네트워크를 확인한 뒤 같은 ba push 명령을 다시 실행하세요.",
            )
        return True

    def configured_actor(self) -> str | None:
        value = self._git_text(["config", "user.name"])
        return value.strip() if value and value.strip() else None

    def _git_text(self, arguments: list[str]) -> str | None:
        result = self._git(arguments, check=False)
        if result.returncode != 0:
            return None
        return result.stdout.strip() or None

    def _git(
        self,
        arguments: list[str],
        *,
        check: bool = True,
        env: dict[str, str] | None = None,
        timeout: int = 30,
    ) -> subprocess.CompletedProcess[str]:
        try:
            result = subprocess.run(
                ["git", *arguments],
                cwd=self.root,
                text=True,
                capture_output=True,
                check=False,
                timeout=timeout,
                env=env,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            if check:
                raise BAError("E_GIT", f"Git 명령을 실행하지 못했습니다: {exc}") from exc
            return subprocess.CompletedProcess(["git", *arguments], 1, "", str(exc))
        if check and result.returncode != 0:
            raise BAError(
                "E_GIT",
                f"Git 명령이 실패했습니다: {result.stderr.strip() or 'unknown error'}",
            )
        return result

