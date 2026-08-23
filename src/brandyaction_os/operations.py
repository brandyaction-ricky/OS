from __future__ import annotations

import getpass
import os
import shutil
import tempfile
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .errors import BAError
from .frontmatter import (
    MarkdownDocument,
    parse_versioned_filename,
    read_document,
    serialize_document,
    write_document,
)
from .repository import CONTENT_ID_PATTERN, Repository
from .util import atomic_write_json, atomic_write_text, now_iso, read_json, sha256_file
from .validation import ValidationReport, Validator


@dataclass(slots=True)
class PullResult:
    content_id: str
    step: str
    workspace: Path
    skill_id: str | None
    inputs: list[str]
    outputs: list[str]


@dataclass(slots=True)
class PushResult:
    content_id: str
    step: str
    files: list[Path]
    completed: bool
    next_step: str | None
    commit: str | None
    remote_pushed: bool
    resumed: bool = False


@dataclass(slots=True)
class NewContentResult:
    content_id: str
    path: Path
    commit: str | None
    remote_pushed: bool


class TextTransaction:
    """Apply UTF-8 text changes atomically per file and support full rollback."""

    def __init__(self, changes: dict[Path, str]) -> None:
        self.changes = changes
        self.originals: dict[Path, str | None] = {}
        self.applied = False

    def apply(self) -> None:
        if self.applied:
            return
        try:
            for path in self.changes:
                self.originals[path] = path.read_text(encoding="utf-8") if path.exists() else None
            for path, text in self.changes.items():
                atomic_write_text(path, text)
            self.applied = True
        except Exception:
            self.rollback()
            raise

    def rollback(self) -> None:
        for path, original in reversed(list(self.originals.items())):
            if original is None:
                if path.exists():
                    path.unlink()
            else:
                atomic_write_text(path, original)
        self.applied = False


class BAService:
    WORKSPACE_FORMAT = "1.0"

    def __init__(self, repository: Repository) -> None:
        self.repository = repository
        self.validator = Validator(repository)
        self.timezone = str(repository.manifest.get("default_timezone", "Asia/Seoul"))

    def actor(self, explicit: str | None = None) -> str:
        value = (
            explicit
            or os.environ.get("BA_USER")
            or self.repository.configured_actor()
            or getpass.getuser()
        )
        value = value.strip()
        if not value:
            raise BAError(
                "E_ACTOR",
                "작업자를 결정할 수 없습니다.",
                hint="--by 또는 BA_USER를 지정하세요.",
            )
        return value

    def status(self, content_id: str | None = None) -> dict[str, Any]:
        if content_id:
            content = self.repository.content_document(content_id)
            metadata = content.metadata
            process_id = str(metadata.get("type"))
            steps = []
            for step in self.repository.process_steps(process_id):
                step_id = str(step.get("id"))
                outputs: list[dict[str, Any]] = []
                for output in step.get("outputs", []):
                    if not isinstance(output, dict):
                        continue
                    pointer_name = str(output.get("pointer"))
                    outputs.append(
                        {
                            "key": output.get("key"),
                            "pointer": metadata.get(pointer_name),
                        }
                    )
                steps.append(
                    {
                        "order": step.get("order"),
                        "id": step_id,
                        "label": step.get("label"),
                        "status": metadata.get(f"{step_id}_status"),
                        "owner": step.get("default_owner"),
                        "outputs": outputs,
                    }
                )
            workspace = self.repository.workspace_path(content_id)
            workspace_state = None
            if (workspace / "workspace.json").is_file():
                try:
                    workspace_state = read_json(workspace / "workspace.json").get("state")
                except (OSError, ValueError):
                    workspace_state = "invalid"
            return {
                "content": metadata,
                "steps": steps,
                "workspace_state": workspace_state,
            }

        items: list[dict[str, Any]] = []
        for candidate in self.repository.content_ids():
            try:
                metadata = self.repository.content_document(candidate).metadata
                items.append(
                    {
                        "id": candidate,
                        "type": metadata.get("type"),
                        "current_step": metadata.get("current_step"),
                        "status": metadata.get("status"),
                        "owner": metadata.get("owner"),
                        "next_action": metadata.get("next_action"),
                        "updated_at": metadata.get("updated_at"),
                    }
                )
            except BAError as exc:
                items.append(
                    {
                        "id": candidate,
                        "type": "invalid",
                        "current_step": "-",
                        "status": exc.code,
                        "owner": "-",
                        "next_action": exc.message,
                        "updated_at": "-",
                    }
                )
        return {"items": items}

    def pull(
        self,
        content_id: str,
        *,
        step_id: str | None = None,
        force: bool = False,
        offline: bool = False,
        by: str | None = None,
    ) -> PullResult:
        actor = self.actor(by)
        content = self.repository.content_document(content_id)
        self._require_valid(self.validator.validate_path(content.path), "CONTENT.md")
        process_id = str(content.metadata.get("type"))
        process = self.repository.process_document(process_id)
        self._require_valid(self.validator.validate_path(process.path), "Process")
        step_name = step_id or str(content.metadata.get("current_step"))
        step = self.repository.process_step(process_id, step_name)

        git_state = self.repository.git_state(refresh=not offline)
        workspace = self.repository.workspace_path(content_id)
        self._prepare_workspace_target(workspace, force=force)
        self.repository.workspace_root.mkdir(parents=True, exist_ok=True)
        temporary = Path(
            tempfile.mkdtemp(
                prefix=f".{content_id}-",
                dir=self.repository.workspace_root,
            )
        )
        copied_inputs: list[str] = []
        output_files: list[str] = []
        skill_id = step.get("skill_id") if isinstance(step.get("skill_id"), str) else None
        try:
            shutil.copy2(content.path, temporary / "CONTEXT.md")
            input_root = temporary / "input"
            output_root = temporary / "output"
            input_root.mkdir()
            output_root.mkdir()

            for pointer_name in step.get("input_pointers", []):
                pointer = content.metadata.get(pointer_name)
                if not isinstance(pointer, str) or not pointer:
                    raise BAError(
                        "E_INPUT_MISSING",
                        f"{step_name} 단계에 필요한 입력 포인터가 없습니다: {pointer_name}",
                        hint="이전 단계의 Completion Condition과 CONTENT.md 포인터를 확인하세요.",
                    )
                source = self.repository.resolve_content_pointer(content_id, pointer)
                destination = input_root / pointer_name / source.name
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, destination)
                copied_inputs.append(destination.relative_to(temporary).as_posix())

            for scope, paths in self.repository.context_files(content.metadata).items():
                for source in paths:
                    destination = input_root / f"{scope}_context" / source.name
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source, destination)
                    copied_inputs.append(destination.relative_to(temporary).as_posix())

            if skill_id:
                self._stage_skill(temporary, process_id, step_name, skill_id)

            timestamp = now_iso(self.timezone)
            next_step = self.repository.next_step(process_id, step)
            next_owner = next_step.get("default_owner") if next_step else None
            approval_required = "not_required" not in set(
                step.get("completion", {}).get("accepted_approval_statuses", [])
            )
            outputs_manifest: list[dict[str, Any]] = []
            for output in step.get("outputs", []):
                if not isinstance(output, dict):
                    continue
                key = str(output.get("key"))
                previous_paths = self.repository.versioned_artifacts(content_id, step, key)
                previous = read_document(previous_paths[-1]) if previous_paths else None
                version = self.repository.latest_version(content_id, step, key) + 1
                filename = f"{key}_v{version}.md"
                metadata: dict[str, Any] = deepcopy(previous.metadata) if previous else {}
                metadata.update({
                    "schema_version": "1.0",
                    "id": f"{content_id}-{key}-v{version}",
                    "entity_type": "artifact",
                    "content_id": content_id,
                    "artifact_key": key,
                    "title": content.metadata.get("title"),
                    "process": process_id,
                    "step": step_name,
                    "status": "draft",
                    "owner": content.metadata.get("owner") or actor,
                    "next_owner": next_owner,
                    "version": version,
                    "is_latest": True,
                    "created_at": timestamp,
                    "updated_at": timestamp,
                    "updated_by": actor,
                    "ai_used": bool(previous.metadata.get("ai_used", False)) if previous else False,
                    "approval_status": "pending" if approval_required else "not_required",
                    "next_action": step.get("review_action"),
                })
                if version > 1:
                    metadata["parent_id"] = f"{content_id}-{key}-v{version - 1}"
                if skill_id:
                    metadata["skill_id"] = skill_id
                body = previous.body if previous else (
                    f"# {step.get('label')} · {key}\n\n"
                    "<!-- 이 주석을 지우고 작업 결과를 작성하세요. -->\n"
                )
                destination = output_root / filename
                write_document(destination, metadata, body)
                output_files.append(destination.relative_to(temporary).as_posix())
                outputs_manifest.append(
                    {
                        "key": key,
                        "file": destination.relative_to(temporary).as_posix(),
                        "version": version,
                        "pointer": output.get("pointer"),
                        "required": bool(output.get("required")),
                    }
                )

            workspace_manifest = {
                "workspace_format": self.WORKSPACE_FORMAT,
                "state": "working",
                "content_id": content_id,
                "process": process_id,
                "step": step_name,
                "skill_id": skill_id,
                "actor": actor,
                "pulled_at": timestamp,
                "base_snapshot": self.repository.snapshot(content_id, step),
                "git": git_state.as_dict(),
                "inputs": copied_inputs,
                "outputs": outputs_manifest,
            }
            atomic_write_json(temporary / "workspace.json", workspace_manifest)
            temporary.rename(workspace)
        except Exception:
            if temporary.exists():
                shutil.rmtree(temporary)
            raise

        return PullResult(
            content_id=content_id,
            step=step_name,
            workspace=workspace,
            skill_id=skill_id,
            inputs=copied_inputs,
            outputs=output_files,
        )

    def skill(
        self,
        content_id: str,
        skill_id: str | None = None,
    ) -> dict[str, Any]:
        workspace, manifest = self._load_workspace(content_id)
        if manifest.get("state") != "working":
            raise BAError(
                "E_WORKSPACE_CLOSED",
                f"현재 Workspace 상태에서는 Skill을 바꿀 수 없습니다: {manifest.get('state')}",
                hint="새로 ba pull을 실행하세요.",
            )
        process_id = str(manifest.get("process"))
        step_id = str(manifest.get("step"))
        step = self.repository.process_step(process_id, step_id)
        selected = skill_id or step.get("skill_id")
        if not isinstance(selected, str) or not selected:
            raise BAError("E_SKILL_NOT_CONFIGURED", f"{step_id} 단계에 연결된 Skill이 없습니다.")
        document = self._stage_skill(workspace, process_id, step_id, selected)
        manifest["skill_id"] = selected
        manifest["skill_version"] = document.metadata.get("version")
        manifest["skill_sha256"] = sha256_file(document.path)
        atomic_write_json(workspace / "workspace.json", manifest)
        return {
            "content_id": content_id,
            "step": step_id,
            "skill_id": selected,
            "version": document.metadata.get("version"),
            "path": workspace / "SKILL.md",
        }

    def push(
        self,
        content_id: str,
        *,
        step_id: str | None = None,
        offline: bool = False,
        by: str | None = None,
    ) -> PushResult:
        actor = self.actor(by)
        workspace, manifest = self._load_workspace(content_id)
        state = manifest.get("state")
        if state in {"repository_written", "git_committed", "push_pending", "pushed_local"}:
            return self._resume_git_sync(workspace, manifest, actor=actor, offline=offline)
        if state == "pushed":
            raise BAError(
                "E_ALREADY_PUSHED",
                "이 Workspace는 이미 Push되었습니다.",
                hint="다음 버전 작업은 ba pull로 새 Workspace를 만드세요.",
            )
        if state != "working":
            raise BAError("E_WORKSPACE_STATE", f"알 수 없는 Workspace 상태입니다: {state!r}")

        process_id = str(manifest.get("process"))
        workspace_step = str(manifest.get("step"))
        if step_id and step_id != workspace_step:
            raise BAError(
                "E_STEP_MISMATCH",
                f"Workspace Step은 {workspace_step!r}인데 Push Step은 {step_id!r}입니다.",
            )
        step = self.repository.process_step(process_id, workspace_step)
        changed = self.repository.snapshot_changed(
            content_id,
            step,
            manifest.get("base_snapshot", {}),
        )
        if changed:
            raise BAError(
                "E_WORKSPACE_STALE",
                "Pull 이후 OS 저장소의 관련 파일이 변경되어 Push를 차단했습니다: "
                + ", ".join(changed),
                hint="현재 output을 별도 보존하고 새로 Pull한 뒤 변경 내용을 다시 반영하세요.",
            )
        self.repository.assert_remote_unchanged(manifest.get("git"), offline=offline)

        content = self.repository.content_document(content_id)
        self._require_valid(self.validator.validate_path(content.path), "CONTENT.md")
        output_root = workspace / "output"
        if not output_root.is_dir():
            raise BAError("E_OUTPUT_DIR", "Workspace output 폴더가 없습니다.")

        configured_outputs = {
            str(output.get("key")): output
            for output in step.get("outputs", [])
            if isinstance(output, dict)
        }
        prepared: dict[str, tuple[Path, MarkdownDocument, str]] = {}
        candidates = sorted(path for path in output_root.glob("*.md") if path.is_file())
        for path in candidates:
            parsed = parse_versioned_filename(path)
            if not parsed:
                raise BAError(
                    "E_OUTPUT_FILENAME",
                    f"Output 파일명이 *_vN.md 형식이 아닙니다: {path.name}",
                )
            key, filename_version = parsed
            if key not in configured_outputs:
                raise BAError(
                    "E_OUTPUT_UNEXPECTED",
                    f"{workspace_step} 단계에 정의되지 않은 Output입니다: {key}",
                )
            if key in prepared:
                raise BAError("E_OUTPUT_DUPLICATE", f"같은 Output이 두 개입니다: {key}")
            expected_version = self.repository.latest_version(content_id, step, key) + 1
            if filename_version != expected_version:
                raise BAError(
                    "E_VERSION_CONFLICT",
                    f"{key}의 다음 버전은 v{expected_version}이어야 하지만 v{filename_version}입니다.",
                )
            document = read_document(path)
            metadata = deepcopy(document.metadata)
            metadata["updated_at"] = now_iso(self.timezone)
            metadata["updated_by"] = actor
            serialized = serialize_document(metadata, document.body)
            normalized = MarkdownDocument(path, metadata, document.body)
            report = self.validator.validate_document(normalized)
            self._require_valid(report, path.name)
            if metadata.get("content_id") != content_id:
                raise BAError(
                    "E_OUTPUT_CONTENT_ID",
                    f"{path.name}의 content_id가 {content_id}와 다릅니다.",
                )
            if metadata.get("step") != workspace_step:
                raise BAError(
                    "E_OUTPUT_STEP",
                    f"{path.name}의 step이 {workspace_step}와 다릅니다.",
                )
            prepared[key] = (path, normalized, serialized)

        required_keys = {
            key for key, output in configured_outputs.items() if bool(output.get("required"))
        }
        missing = sorted(required_keys - set(prepared))
        if missing:
            raise BAError(
                "E_OUTPUT_MISSING",
                "필수 Output이 없습니다: " + ", ".join(missing),
            )

        changes: dict[Path, str] = {}
        changed_paths: list[Path] = []
        content_metadata = deepcopy(content.metadata)
        for key, (_, document, serialized) in prepared.items():
            target_dir = self.repository.step_dir(content_id, step)
            target = target_dir / f"{key}_v{document.metadata['version']}.md"
            if target.exists():
                raise BAError("E_VERSION_EXISTS", f"대상 버전이 이미 존재합니다: {target.name}")
            changes[target] = serialized
            changed_paths.append(target)

            for previous_path in self.repository.versioned_artifacts(content_id, step, key):
                previous = read_document(previous_path)
                if previous.metadata.get("is_latest") is True:
                    previous_metadata = deepcopy(previous.metadata)
                    previous_metadata["is_latest"] = False
                    changes[previous_path] = serialize_document(previous_metadata, previous.body)
                    changed_paths.append(previous_path)

            pointer_name = str(configured_outputs[key].get("pointer"))
            pointer_value = target.relative_to(self.repository.content_dir(content_id)).as_posix()
            content_metadata[pointer_name] = pointer_value
            if key == "edit":
                content_metadata["latest_master"] = pointer_value

        completed = self._completion_met(step, {key: item[1] for key, item in prepared.items()})
        current_status_key = f"{workspace_step}_status"
        next_step = self.repository.next_step(process_id, step)
        if completed:
            content_metadata[current_status_key] = step.get("completion", {}).get(
                "result_status", "completed"
            )
            if next_step:
                next_step_id = str(next_step.get("id"))
                content_metadata[f"{next_step_id}_status"] = "ready"
                content_metadata["current_step"] = next_step_id
                content_metadata["owner"] = next_step.get("default_owner")
                following = self.repository.next_step(process_id, next_step)
                content_metadata["next_owner"] = (
                    following.get("default_owner") if following else None
                )
                content_metadata["next_action"] = next_step.get("work_action")
                content_metadata["status"] = "in_progress"
            else:
                content_metadata["status"] = "completed"
                content_metadata["next_owner"] = None
                content_metadata["next_action"] = "공정 완료"
            for lock_key in ("locked_by", "locked_step", "locked_at"):
                content_metadata.pop(lock_key, None)
        else:
            content_metadata[current_status_key] = self._derive_step_status(
                [item[1] for item in prepared.values()]
            )
            content_metadata["status"] = "in_progress"
            content_metadata["next_action"] = (
                step.get("review_action")
                if content_metadata[current_status_key] in {"review", "waiting_approval", "waiting_human"}
                else step.get("work_action")
            )
            content_metadata["next_owner"] = next_step.get("default_owner") if next_step else None

        content_metadata["version"] = int(content_metadata.get("version", 0)) + 1
        content_metadata["updated_at"] = now_iso(self.timezone)
        content_metadata["updated_by"] = actor
        changes[content.path] = serialize_document(content_metadata, content.body)
        changed_paths.append(content.path)

        transaction = TextTransaction(changes)
        transaction.apply()
        integrity = self.validator.validate_content_integrity(content_id)
        content_report = self.validator.validate_path(content.path)
        if not integrity.valid or not content_report.valid:
            transaction.rollback()
            combined = ValidationReport()
            combined.extend(content_report)
            combined.extend(integrity)
            self._require_valid(combined, "Push 결과")

        manifest["state"] = "repository_written"
        manifest["repository_written_at"] = now_iso(self.timezone)
        manifest["changed_paths"] = [
            path.relative_to(self.repository.root).as_posix()
            for path in sorted(set(changed_paths))
        ]
        manifest["push_result"] = {
            "completed": completed,
            "next_step": next_step.get("id") if completed and next_step else None,
            "step": workspace_step,
        }
        atomic_write_json(workspace / "workspace.json", manifest)
        return self._finalize_git_sync(workspace, manifest, actor=actor, offline=offline)

    def new_content(
        self,
        *,
        content_type: str,
        title: str | None = None,
        owner: str | None = None,
        content_id: str | None = None,
        offline: bool = False,
        by: str | None = None,
    ) -> NewContentResult:
        actor = self.actor(by)
        process = self.repository.process_document(content_type)
        self._require_valid(self.validator.validate_path(process.path), "Process")
        self.repository.git_state(refresh=not offline)
        generated_id = content_id or self._next_content_id()
        self.repository.validate_content_id(generated_id)
        target = self.repository.contents_root / generated_id
        if target.exists():
            raise BAError("E_CONTENT_EXISTS", f"이미 존재하는 Content ID입니다: {generated_id}")

        steps = self.repository.process_steps(content_type)
        first_step_id = str(process.metadata.get("first_step"))
        first_step = self.repository.process_step(content_type, first_step_id)
        timestamp = now_iso(self.timezone)
        content_owner = owner or str(first_step.get("default_owner") or actor)
        metadata: dict[str, Any] = {
            "schema_version": "1.0",
            "id": generated_id,
            "entity_type": "content",
            "type": content_type,
            "brand_id": "brandyaction",
            "title": title or "제목 미정",
            "status": "ready",
            "current_step": first_step_id,
            "owner": content_owner,
            "next_owner": (
                self.repository.next_step(content_type, first_step) or {}
            ).get("default_owner"),
            "version": 1,
            "process_path": process.path.relative_to(self.repository.root).as_posix(),
            "process_version": str(process.metadata.get("version")),
            "next_action": first_step.get("work_action"),
            "created_at": timestamp,
            "updated_at": timestamp,
            "updated_by": actor,
        }
        for step in steps:
            step_id = str(step.get("id"))
            metadata[f"{step_id}_status"] = "ready" if step_id == first_step_id else "locked"
            for output in step.get("outputs", []):
                if isinstance(output, dict):
                    metadata[str(output.get("pointer"))] = None
        metadata.setdefault("latest_master", None)

        body = (
            "# Current Context\n\n"
            "이 Content Run의 목표, 고객, 핵심 제약과 최신 의사결정을 작성한다.\n"
        )
        changes: dict[Path, str] = {target / "CONTENT.md": serialize_document(metadata, body)}
        for step in steps:
            folder = str(step.get("folder"))
            changes[target / folder / ".gitkeep"] = ""
        transaction = TextTransaction(changes)
        transaction.apply()
        report = self.validator.validate_path(target / "CONTENT.md")
        integrity = self.validator.validate_content_integrity(generated_id)
        if not report.valid or not integrity.valid:
            transaction.rollback()
            self._remove_empty_tree(target)
            combined = ValidationReport()
            combined.extend(report)
            combined.extend(integrity)
            self._require_valid(combined, "새 Content Run")

        paths = list(changes)
        commit = self.repository.commit_paths(
            paths,
            f"ba: create {generated_id} ({content_type})",
            actor,
        )
        remote_pushed = self.repository.push_upstream(offline=offline)
        return NewContentResult(generated_id, target, commit, remote_pushed)

    def validate(self, paths: list[Path] | None = None) -> ValidationReport:
        if paths:
            return self.validator.validate_paths(paths)
        return self.validator.validate_repository()

    def _next_content_id(self) -> str:
        config = self.repository.manifest.get("content_id", {})
        prefix = str(config.get("prefix", "BA")) if isinstance(config, dict) else "BA"
        digits = int(config.get("digits", 4)) if isinstance(config, dict) else 4
        maximum = 0
        pattern = CONTENT_ID_PATTERN if prefix == "BA" and digits == 4 else None
        for content_id in self.repository.content_ids():
            if pattern and not pattern.fullmatch(content_id):
                continue
            try:
                maximum = max(maximum, int(content_id.split("-", 1)[1]))
            except (IndexError, ValueError):
                continue
        next_number = maximum + 1
        if next_number >= 10**digits:
            raise BAError("E_CONTENT_ID_EXHAUSTED", "Content ID 번호 범위를 초과했습니다.")
        return f"{prefix}-{next_number:0{digits}d}"

    def _prepare_workspace_target(self, workspace: Path, *, force: bool) -> None:
        if not workspace.exists():
            return
        if workspace.is_symlink() or not workspace.resolve().is_relative_to(
            self.repository.workspace_root.resolve()
        ):
            raise BAError("E_WORKSPACE_PATH", "안전하지 않은 Workspace 경로입니다.")
        manifest_path = workspace / "workspace.json"
        state = None
        if manifest_path.is_file():
            try:
                state = read_json(manifest_path).get("state")
            except (OSError, ValueError):
                state = "invalid"
        if not force and state != "pushed":
            raise BAError(
                "E_WORKSPACE_EXISTS",
                f"작업 중인 Workspace가 이미 있습니다: {workspace}",
                hint="기존 output을 확인한 뒤 교체하려면 --force를 명시하세요.",
            )
        shutil.rmtree(workspace)

    def _load_workspace(self, content_id: str) -> tuple[Path, dict[str, Any]]:
        workspace = self.repository.workspace_path(content_id)
        manifest_path = workspace / "workspace.json"
        if not manifest_path.is_file():
            raise BAError(
                "E_WORKSPACE_NOT_FOUND",
                f"Pull된 Workspace가 없습니다: {content_id}",
                hint=f"ba pull {content_id}를 먼저 실행하세요.",
            )
        try:
            manifest = read_json(manifest_path)
        except (OSError, ValueError) as exc:
            raise BAError("E_WORKSPACE_MANIFEST", f"workspace.json이 손상되었습니다: {exc}") from exc
        if manifest.get("workspace_format") != self.WORKSPACE_FORMAT:
            raise BAError("E_WORKSPACE_FORMAT", "지원하지 않는 Workspace 형식입니다.")
        if manifest.get("content_id") != content_id:
            raise BAError("E_WORKSPACE_CONTENT", "Workspace Content ID가 일치하지 않습니다.")
        return workspace, manifest

    def _stage_skill(
        self,
        workspace: Path,
        process_id: str,
        step_id: str,
        skill_id: str,
    ) -> MarkdownDocument:
        document = self.repository.skill_document(skill_id)
        self._require_valid(self.validator.validate_path(document.path), f"Skill {skill_id}")
        if document.metadata.get("process") != process_id or document.metadata.get("step") != step_id:
            raise BAError(
                "E_SKILL_SCOPE",
                f"{skill_id}은 {process_id}/{step_id} 단계용 Skill이 아닙니다.",
            )
        skill_target = workspace / "skill"
        if skill_target.exists():
            if skill_target.is_symlink() or not skill_target.resolve().is_relative_to(workspace.resolve()):
                raise BAError("E_SKILL_PATH", "안전하지 않은 Workspace Skill 경로입니다.")
            shutil.rmtree(skill_target)
        shutil.copytree(document.path.parent, skill_target)
        shutil.copy2(document.path, workspace / "SKILL.md")
        return document

    def _completion_met(
        self,
        step: dict[str, Any],
        documents: dict[str, MarkdownDocument],
    ) -> bool:
        completion = step.get("completion", {})
        accepted_statuses = set(completion.get("accepted_statuses", []))
        accepted_approvals = set(completion.get("accepted_approval_statuses", []))
        required = {
            str(output.get("key"))
            for output in step.get("outputs", [])
            if isinstance(output, dict) and bool(output.get("required"))
        }
        if not required.issubset(documents):
            return False
        return all(
            documents[key].metadata.get("status") in accepted_statuses
            and documents[key].metadata.get("approval_status") in accepted_approvals
            for key in required
        )

    @staticmethod
    def _derive_step_status(documents: list[MarkdownDocument]) -> str:
        approvals = {document.metadata.get("approval_status") for document in documents}
        statuses = {document.metadata.get("status") for document in documents}
        if "rejected" in approvals or "rejected" in statuses:
            return "rejected"
        if approvals & {"pending", "conditional"}:
            return "waiting_approval"
        if statuses & {"waiting_human", "waiting_approval", "review"}:
            return "review"
        if statuses == {"draft"}:
            return "in_progress"
        return "in_progress"

    def _finalize_git_sync(
        self,
        workspace: Path,
        manifest: dict[str, Any],
        *,
        actor: str,
        offline: bool,
    ) -> PushResult:
        paths = [self.repository.root / value for value in manifest.get("changed_paths", [])]
        push_result = manifest.get("push_result", {})
        commit = self.repository.commit_paths(
            paths,
            f"ba: push {manifest.get('content_id')} {manifest.get('step')}",
            actor,
        )
        manifest["commit"] = commit
        manifest["state"] = "git_committed"
        atomic_write_json(workspace / "workspace.json", manifest)
        try:
            remote_pushed = self.repository.push_upstream(offline=offline)
        except BAError:
            manifest["state"] = "push_pending"
            atomic_write_json(workspace / "workspace.json", manifest)
            raise
        git_state = self.repository.git_state(refresh=False)
        manifest["state"] = (
            "pushed_local" if offline and git_state.upstream_ref else "pushed"
        )
        manifest["pushed_at"] = now_iso(self.timezone)
        manifest["remote_pushed"] = remote_pushed
        atomic_write_json(workspace / "workspace.json", manifest)
        return PushResult(
            content_id=str(manifest.get("content_id")),
            step=str(push_result.get("step")),
            files=paths,
            completed=bool(push_result.get("completed")),
            next_step=push_result.get("next_step"),
            commit=commit,
            remote_pushed=remote_pushed,
        )

    def _resume_git_sync(
        self,
        workspace: Path,
        manifest: dict[str, Any],
        *,
        actor: str,
        offline: bool,
    ) -> PushResult:
        if manifest.get("state") == "pushed_local" and offline:
            raise BAError(
                "E_ALREADY_PUSHED_LOCAL",
                "이 Workspace는 이미 로컬 Git에 Push되었습니다.",
                hint="원격으로 보낼 때 --offline 없이 같은 명령을 실행하세요.",
            )
        result = self._finalize_git_sync(workspace, manifest, actor=actor, offline=offline)
        result.resumed = True
        return result

    @staticmethod
    def _remove_empty_tree(path: Path) -> None:
        if path.exists() and path.is_dir():
            shutil.rmtree(path)

    def _require_valid(self, report: ValidationReport, label: str) -> None:
        if report.valid:
            return
        preview = "; ".join(
            f"{issue.path.name}: {issue.message}" for issue in report.issues[:5]
        )
        if len(report.issues) > 5:
            preview += f"; 외 {len(report.issues) - 5}건"
        raise BAError(
            "E_VALIDATION",
            f"{label} 검증에 실패했습니다: {preview}",
            hint="ba validate로 전체 오류를 확인하세요.",
        )
