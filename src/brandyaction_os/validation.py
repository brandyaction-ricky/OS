from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

from .errors import BAError
from .frontmatter import MarkdownDocument, parse_versioned_filename, read_document
from .repository import CONTENT_ID_PATTERN, Repository


@dataclass(slots=True)
class ValidationIssue:
    code: str
    path: Path
    message: str

    def as_dict(self, root: Path | None = None) -> dict[str, str]:
        path = self.path
        if root:
            try:
                path = path.resolve().relative_to(root.resolve())
            except ValueError:
                pass
        return {"code": self.code, "path": path.as_posix(), "message": self.message}


@dataclass(slots=True)
class ValidationReport:
    checked: int = 0
    issues: list[ValidationIssue] = field(default_factory=list)

    @property
    def valid(self) -> bool:
        return not self.issues

    def extend(self, other: "ValidationReport") -> None:
        self.checked += other.checked
        self.issues.extend(other.issues)


class Validator:
    REQUIRED_SKILL_FIELDS = {
        "skill_id",
        "skill_type",
        "category_id",
        "category_label",
        "folder_id",
        "folder_label",
        "version",
        "process",
        "step",
        "status",
        "inputs",
        "outputs",
        "allowed_tools",
        "completion_checks",
    }
    REQUIRED_SKILL_SECTIONS = {
        "PURPOSE",
        "READ CONTEXT",
        "PROCEDURE",
        "OUTPUT CONTRACT",
        "QUALITY CRITERIA",
        "DO NOT",
        "HANDOFF",
    }

    def __init__(self, repository: Repository) -> None:
        self.repository = repository
        schema_path = repository.root / "00_system" / "schemas" / "frontmatter.schema.json"
        try:
            self.schema = json.loads(schema_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise BAError("E_SCHEMA_FILE", f"Validator Schema를 읽을 수 없습니다: {exc}") from exc
        self.status_values = set(self.schema.get("status_values", []))
        self.approval_values = set(self.schema.get("approval_status_values", []))
        category_path = repository.root / "04_skills" / "CATEGORIES.json"
        try:
            registry = json.loads(category_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise BAError("E_SKILL_CATEGORIES", f"Skill 카테고리 정의를 읽을 수 없습니다: {exc}") from exc
        self.skill_categories = {
            category["id"]: {folder["id"] for folder in category.get("folders", [])}
            for category in registry.get("categories", [])
        }

    def validate_repository(self) -> ValidationReport:
        paths: list[Path] = []
        paths.extend(sorted((self.repository.root / "05_contents").glob("*/**/*.md")))
        paths.extend(sorted((self.repository.root / "04_skills").rglob("SKILL.md")))
        paths.extend(sorted((self.repository.root / "03_processes").glob("*/PROCESS.md")))
        paths.extend(sorted((self.repository.root / "01_company" / "context").glob("*.md")))
        paths.extend(sorted((self.repository.root / "02_brands").glob("*/context/*.md")))
        paths.extend(sorted((self.repository.root / "06_meetings").glob("**/*.md")))
        paths.extend(sorted((self.repository.root / "07_automations").glob("**/*.md")))
        paths.extend(sorted((self.repository.root / "08_people").glob("*/WORKSPACE.md")))
        paths.extend(sorted((self.repository.root / "10_wiki" / "company").glob("**/*.md")))
        paths.extend(sorted((self.repository.root / "10_wiki" / "process").glob("**/*.md")))
        paths.extend(sorted((self.repository.root / "10_wiki" / "people").glob("**/*.md")))
        report = self.validate_paths(paths)
        for content_id in self.repository.content_ids():
            report.extend(self.validate_content_integrity(content_id))
        report.extend(self.validate_automation_integrity())
        return report

    def validate_paths(self, paths: Iterable[Path]) -> ValidationReport:
        expanded: list[Path] = []
        for path in paths:
            absolute = path if path.is_absolute() else self.repository.root / path
            if absolute.is_dir():
                expanded.extend(sorted(absolute.rglob("*.md")))
            else:
                expanded.append(absolute)
        report = ValidationReport()
        for path in sorted(set(expanded)):
            report.extend(self.validate_path(path))
        return report

    def validate_path(self, path: Path) -> ValidationReport:
        try:
            document = read_document(path)
        except BAError as exc:
            report = ValidationReport(checked=1)
            report.issues.append(ValidationIssue(exc.code, path, exc.message))
            return report

        return self.validate_document(document)

    def validate_document(self, document: MarkdownDocument) -> ValidationReport:
        report = ValidationReport(checked=1)
        path = document.path
        metadata = document.metadata
        if path.name == "SKILL.md":
            self._validate_skill(document, report)
        elif path.name == "PROCESS.md" or metadata.get("entity_type") == "process":
            self._validate_process(document, report)
        else:
            self._validate_entity(document, report)
        return report

    def _validate_entity(self, document: MarkdownDocument, report: ValidationReport) -> None:
        metadata = document.metadata
        path = document.path
        entity_type = metadata.get("entity_type")
        rules = self.schema.get("entity_rules", {})
        if entity_type not in rules:
            report.issues.append(
                ValidationIssue(
                    "E_ENTITY_TYPE",
                    path,
                    f"지원하지 않는 entity_type입니다: {entity_type!r}",
                )
            )
            return

        if metadata.get("schema_version") != self.schema.get("schema_version"):
            report.issues.append(
                ValidationIssue(
                    "E_SCHEMA_VERSION",
                    path,
                    f"schema_version은 {self.schema.get('schema_version')!r}이어야 합니다.",
                )
            )

        for key in rules[entity_type].get("required", []):
            if key not in metadata or metadata[key] is None or metadata[key] == "":
                report.issues.append(
                    ValidationIssue("E_REQUIRED", path, f"필수 Frontmatter가 없습니다: {key}")
                )

        version = metadata.get("version")
        if not isinstance(version, int) or isinstance(version, bool) or version < 1:
            report.issues.append(
                ValidationIssue("E_VERSION", path, "version은 1 이상의 정수여야 합니다.")
            )

        for key in ("created_at", "updated_at"):
            if key in metadata and not self._is_timezone_timestamp(metadata[key]):
                report.issues.append(
                    ValidationIssue(
                        "E_TIMESTAMP",
                        path,
                        f"{key}은 timezone이 포함된 ISO 8601 문자열이어야 합니다.",
                    )
                )

        if entity_type in {"content", "artifact"}:
            status = metadata.get("status")
            if status not in self.status_values:
                report.issues.append(
                    ValidationIssue("E_STATUS", path, f"허용되지 않은 status입니다: {status!r}")
                )

        if entity_type == "content":
            self._validate_content_document(document, report)
        elif entity_type == "artifact":
            self._validate_artifact_document(document, report)
        elif entity_type == "context":
            if metadata.get("status") not in {"active", "archived"}:
                report.issues.append(
                    ValidationIssue(
                        "E_CONTEXT_STATUS",
                        path,
                        "Context status는 active 또는 archived여야 합니다.",
                    )
                )
        elif entity_type == "person_workspace":
            if metadata.get("status") not in {"active", "archived"}:
                report.issues.append(ValidationIssue("E_WORKSPACE_STATUS", path, "직원 Workspace status는 active 또는 archived여야 합니다."))
        elif entity_type == "wiki":
            if metadata.get("wiki_type") not in {"company", "process", "people"}:
                report.issues.append(ValidationIssue("E_WIKI_TYPE", path, "wiki_type은 company, process 또는 people이어야 합니다."))
            if metadata.get("status") not in {"active", "archived"}:
                report.issues.append(ValidationIssue("E_WIKI_STATUS", path, "Wiki status는 active 또는 archived여야 합니다."))
        elif entity_type == "meeting":
            if metadata.get("status") not in {"inbox", "organized", "decision", "archived"}:
                report.issues.append(ValidationIssue("E_MEETING_STATUS", path, "Meeting status는 inbox, organized, decision 또는 archived여야 합니다."))
            if metadata.get("source_type") not in {"manual", "recording", "upload"}:
                report.issues.append(ValidationIssue("E_MEETING_SOURCE", path, "source_type은 manual, recording 또는 upload여야 합니다."))
            if metadata.get("transcript_status") not in {"not_required", "pending", "completed", "failed"}:
                report.issues.append(ValidationIssue("E_TRANSCRIPT_STATUS", path, "허용되지 않은 transcript_status입니다."))
            if metadata.get("summary_status") not in {"draft", "completed"}:
                report.issues.append(ValidationIssue("E_SUMMARY_STATUS", path, "summary_status는 draft 또는 completed여야 합니다."))
        elif entity_type == "automation_result":
            if metadata.get("status") not in {"needs_input", "needs_decision", "approved", "completed"}:
                report.issues.append(ValidationIssue("E_AUTOMATION_RESULT_STATUS", path, "Automation 결과 status가 올바르지 않습니다."))
            if metadata.get("provider") not in {"human", "human_ai", "openai", "gemini_image", "render_worker", "premiere_bridge", "youtube", "youtube_data"}:
                report.issues.append(ValidationIssue("E_AUTOMATION_PROVIDER", path, "Automation provider가 올바르지 않습니다."))
        elif entity_type == "automation_recipe":
            if metadata.get("status") not in {"active", "inactive", "deprecated"}:
                report.issues.append(ValidationIssue("E_AUTOMATION_RECIPE_STATUS", path, "Automation Recipe status가 올바르지 않습니다."))
            pipeline_path = metadata.get("pipeline_path")
            if not isinstance(pipeline_path, str) or not (self.repository.root / pipeline_path).is_file():
                report.issues.append(ValidationIssue("E_AUTOMATION_PIPELINE_POINTER", path, "Automation Pipeline 파일을 찾을 수 없습니다."))

    def _validate_content_document(
        self, document: MarkdownDocument, report: ValidationReport
    ) -> None:
        metadata = document.metadata
        path = document.path
        content_id = metadata.get("id")
        if not isinstance(content_id, str) or not CONTENT_ID_PATTERN.fullmatch(content_id):
            report.issues.append(
                ValidationIssue("E_CONTENT_ID", path, "Content id는 BA-0001 형식이어야 합니다.")
            )
        elif path.name == "CONTENT.md" and path.parent.name != content_id:
            report.issues.append(
                ValidationIssue(
                    "E_CONTENT_PATH",
                    path,
                    f"폴더명 {path.parent.name!r}과 id {content_id!r}가 다릅니다.",
                )
            )
        process_path = metadata.get("process_path")
        if isinstance(process_path, str):
            resolved = (self.repository.root / process_path).resolve()
            if not resolved.is_relative_to(self.repository.root) or not resolved.is_file():
                report.issues.append(
                    ValidationIssue(
                        "E_PROCESS_POINTER",
                        path,
                        f"process_path 대상이 없습니다: {process_path}",
                    )
                )

    def _validate_artifact_document(
        self, document: MarkdownDocument, report: ValidationReport
    ) -> None:
        metadata = document.metadata
        path = document.path
        content_id = metadata.get("content_id")
        key = metadata.get("artifact_key")
        version = metadata.get("version")
        parsed = parse_versioned_filename(path)
        if parsed is None:
            report.issues.append(
                ValidationIssue(
                    "E_ARTIFACT_FILENAME",
                    path,
                    "산출물 파일명은 artifact_key_vN.md 형식이어야 합니다.",
                )
            )
        else:
            filename_key, filename_version = parsed
            if key != filename_key:
                report.issues.append(
                    ValidationIssue(
                        "E_ARTIFACT_KEY",
                        path,
                        f"artifact_key {key!r}와 파일명 {filename_key!r}가 다릅니다.",
                    )
                )
            if version != filename_version:
                report.issues.append(
                    ValidationIssue(
                        "E_ARTIFACT_VERSION",
                        path,
                        f"version {version!r}와 파일명 버전 {filename_version}이 다릅니다.",
                    )
                )
        if isinstance(content_id, str) and isinstance(key, str) and isinstance(version, int):
            expected_id = f"{content_id}-{key}-v{version}"
            if metadata.get("id") != expected_id:
                report.issues.append(
                    ValidationIssue(
                        "E_ARTIFACT_ID",
                        path,
                        f"id는 {expected_id!r}이어야 합니다.",
                    )
                )
            if version > 1:
                expected_parent = f"{content_id}-{key}-v{version - 1}"
                if metadata.get("parent_id") != expected_parent:
                    report.issues.append(
                        ValidationIssue(
                            "E_PARENT_ID",
                            path,
                            f"parent_id는 {expected_parent!r}이어야 합니다.",
                        )
                    )
        if not isinstance(metadata.get("is_latest"), bool):
            report.issues.append(
                ValidationIssue("E_IS_LATEST", path, "is_latest는 boolean이어야 합니다.")
            )
        if metadata.get("approval_status") not in self.approval_values:
            report.issues.append(
                ValidationIssue(
                    "E_APPROVAL_STATUS",
                    path,
                    f"허용되지 않은 approval_status입니다: {metadata.get('approval_status')!r}",
                )
            )
        if "ai_used" in metadata and not isinstance(metadata.get("ai_used"), bool):
            report.issues.append(
                ValidationIssue("E_AI_USED", path, "ai_used는 boolean이어야 합니다.")
            )

        try:
            relative = path.resolve().relative_to(self.repository.contents_root.resolve())
        except ValueError:
            return
        if len(relative.parts) >= 2 and relative.parts[0] != content_id:
            report.issues.append(
                ValidationIssue(
                    "E_ARTIFACT_CONTENT_PATH",
                    path,
                    f"파일 경로의 Content ID와 content_id {content_id!r}가 다릅니다.",
                )
            )

    def _validate_skill(self, document: MarkdownDocument, report: ValidationReport) -> None:
        metadata = document.metadata
        path = document.path
        for key in sorted(self.REQUIRED_SKILL_FIELDS):
            if key not in metadata or metadata[key] is None:
                report.issues.append(
                    ValidationIssue("E_SKILL_REQUIRED", path, f"Skill 필수 값이 없습니다: {key}")
                )
        if metadata.get("status") not in {"active", "inactive", "deprecated"}:
            report.issues.append(
                ValidationIssue("E_SKILL_STATUS", path, "Skill status가 올바르지 않습니다.")
            )
        if metadata.get("skill_type") != "os_context_loader":
            report.issues.append(
                ValidationIssue("E_SKILL_TYPE", path, "Skill type은 os_context_loader여야 합니다.")
            )
        skill_id = metadata.get("skill_id")
        if isinstance(skill_id, str) and path.parent.name != skill_id:
            report.issues.append(
                ValidationIssue(
                    "E_SKILL_PATH",
                    path,
                    f"Skill 폴더명과 skill_id {skill_id!r}가 다릅니다.",
                )
            )
        category_id = metadata.get("category_id")
        folder_id = metadata.get("folder_id")
        if category_id not in self.skill_categories or folder_id not in self.skill_categories.get(category_id, set()):
            report.issues.append(
                ValidationIssue("E_SKILL_CATEGORY", path, "등록되지 않은 Skill 카테고리 또는 폴더입니다.")
            )
        try:
            relative = path.relative_to(self.repository.root / "04_skills")
        except ValueError:
            relative = None
        if relative and (len(relative.parts) < 4 or relative.parts[0] != category_id or relative.parts[1] != folder_id):
            report.issues.append(
                ValidationIssue("E_SKILL_CATEGORY_PATH", path, "Skill Frontmatter의 카테고리와 실제 폴더 경로가 다릅니다.")
            )
        for key in ("inputs", "outputs", "allowed_tools", "completion_checks", "wiki_sources"):
            if key in metadata and not isinstance(metadata[key], list):
                report.issues.append(
                    ValidationIssue("E_SKILL_LIST", path, f"{key}는 목록이어야 합니다.")
                )
        sections = {
            match.group(1).strip().upper()
            for match in re.finditer(r"^##\s+(.+?)\s*$", document.body, flags=re.MULTILINE)
        }
        for section in sorted(self.REQUIRED_SKILL_SECTIONS - sections):
            report.issues.append(
                ValidationIssue(
                    "E_SKILL_SECTION",
                    path,
                    f"Skill 필수 섹션이 없습니다: {section}",
                )
            )

    def _validate_process(self, document: MarkdownDocument, report: ValidationReport) -> None:
        metadata = document.metadata
        path = document.path
        for key in ("schema_version", "id", "entity_type", "process_id", "version", "status", "first_step", "steps"):
            if key not in metadata or metadata[key] is None:
                report.issues.append(
                    ValidationIssue("E_PROCESS_REQUIRED", path, f"Process 필수 값이 없습니다: {key}")
                )
        if metadata.get("schema_version") != self.schema.get("schema_version"):
            report.issues.append(
                ValidationIssue("E_SCHEMA_VERSION", path, "Process schema_version이 다릅니다.")
            )
        if metadata.get("entity_type") != "process":
            report.issues.append(
                ValidationIssue("E_PROCESS_ENTITY", path, "entity_type은 process여야 합니다.")
            )
        if metadata.get("status") not in {"active", "inactive", "deprecated"}:
            report.issues.append(
                ValidationIssue("E_PROCESS_STATUS", path, "Process status가 올바르지 않습니다.")
            )
        steps = metadata.get("steps")
        if not isinstance(steps, list) or not steps:
            report.issues.append(
                ValidationIssue("E_PROCESS_STEPS", path, "steps는 비어 있지 않은 목록이어야 합니다.")
            )
            return
        ids: list[str] = []
        orders: list[int] = []
        folders: list[str] = []
        for index, step in enumerate(steps, start=1):
            if not isinstance(step, dict):
                report.issues.append(
                    ValidationIssue("E_PROCESS_STEP", path, f"steps[{index}]가 객체가 아닙니다.")
                )
                continue
            for key in ("id", "order", "label", "folder", "type", "default_owner", "input_pointers", "outputs", "completion", "work_action", "review_action", "next_step"):
                if key not in step:
                    report.issues.append(
                        ValidationIssue(
                            "E_PROCESS_STEP_REQUIRED",
                            path,
                            f"steps[{index}] 필수 값이 없습니다: {key}",
                        )
                    )
            if isinstance(step.get("id"), str):
                ids.append(step["id"])
            if isinstance(step.get("order"), int):
                orders.append(step["order"])
            if isinstance(step.get("folder"), str):
                folders.append(step["folder"])
            outputs = step.get("outputs")
            if not isinstance(outputs, list) or not outputs:
                report.issues.append(
                    ValidationIssue(
                        "E_PROCESS_OUTPUTS",
                        path,
                        f"steps[{index}].outputs는 비어 있지 않은 목록이어야 합니다.",
                    )
                )
            else:
                for output in outputs:
                    if not isinstance(output, dict) or not all(
                        key in output for key in ("key", "pointer", "required")
                    ):
                        report.issues.append(
                            ValidationIssue(
                                "E_PROCESS_OUTPUT",
                                path,
                                f"steps[{index}] Output에는 key/pointer/required가 필요합니다.",
                            )
                        )
            completion = step.get("completion")
            if not isinstance(completion, dict) or not all(
                key in completion
                for key in (
                    "accepted_statuses",
                    "accepted_approval_statuses",
                    "result_status",
                )
            ):
                report.issues.append(
                    ValidationIssue(
                        "E_PROCESS_COMPLETION",
                        path,
                        f"steps[{index}] Completion Condition이 불완전합니다.",
                    )
                )
        if len(ids) != len(set(ids)) or len(orders) != len(set(orders)) or len(folders) != len(set(folders)):
            report.issues.append(
                ValidationIssue("E_PROCESS_DUPLICATE", path, "Step id/order/folder는 중복될 수 없습니다.")
            )
        if metadata.get("first_step") not in ids:
            report.issues.append(
                ValidationIssue("E_PROCESS_FIRST_STEP", path, "first_step이 steps에 없습니다.")
            )
        for step in steps:
            if isinstance(step, dict) and step.get("next_step") is not None and step.get("next_step") not in ids:
                report.issues.append(
                    ValidationIssue(
                        "E_PROCESS_NEXT_STEP",
                        path,
                        f"알 수 없는 next_step입니다: {step.get('next_step')!r}",
                    )
                )

    def validate_content_integrity(self, content_id: str) -> ValidationReport:
        report = ValidationReport()
        try:
            content = self.repository.content_document(content_id)
            process_id = str(content.metadata.get("type", ""))
            steps = self.repository.process_steps(process_id)
        except BAError as exc:
            report.issues.append(
                ValidationIssue(exc.code, self.repository.contents_root / content_id, exc.message)
            )
            return report

        step_ids = {str(step.get("id")) for step in steps}
        if content.metadata.get("current_step") not in step_ids:
            report.issues.append(
                ValidationIssue(
                    "E_CURRENT_STEP",
                    content.path,
                    f"current_step이 Process에 없습니다: {content.metadata.get('current_step')!r}",
                )
            )
        for step in steps:
            status_key = f"{step.get('id')}_status"
            if content.metadata.get(status_key) not in self.status_values:
                report.issues.append(
                    ValidationIssue(
                        "E_STEP_STATUS",
                        content.path,
                        f"{status_key}가 없거나 허용되지 않은 상태입니다.",
                    )
                )

        groups: dict[tuple[str, str], list[tuple[int, Path, MarkdownDocument]]] = {}
        content_dir = self.repository.content_dir(content_id)
        for path in sorted(content_dir.rglob("*_v*.md")):
            parsed = parse_versioned_filename(path)
            if not parsed:
                continue
            key, version = parsed
            try:
                document = read_document(path)
            except BAError:
                continue
            if document.metadata.get("entity_type") != "artifact":
                continue
            groups.setdefault((str(document.metadata.get("step")), key), []).append(
                (version, path, document)
            )

        output_by_key = {
            str(output.get("key")): output
            for step in steps
            for output in step.get("outputs", [])
            if isinstance(output, dict)
        }
        for (_, key), versions in groups.items():
            versions.sort(key=lambda item: item[0])
            version_numbers = [item[0] for item in versions]
            expected_numbers = list(range(1, max(version_numbers) + 1))
            if version_numbers != expected_numbers:
                report.issues.append(
                    ValidationIssue(
                        "E_VERSION_GAP",
                        versions[-1][1],
                        f"{key} 버전이 연속적이지 않습니다: {version_numbers}",
                    )
                )
            latest = [item for item in versions if item[2].metadata.get("is_latest") is True]
            if len(latest) != 1 or latest[0][0] != versions[-1][0]:
                report.issues.append(
                    ValidationIssue(
                        "E_LATEST_FLAG",
                        versions[-1][1],
                        f"{key}의 최고 버전 하나만 is_latest: true여야 합니다.",
                    )
                )
            output = output_by_key.get(key)
            if output:
                pointer_key = output.get("pointer")
                pointer = content.metadata.get(pointer_key)
                expected_pointer = versions[-1][1].relative_to(content_dir).as_posix()
                if pointer != expected_pointer:
                    report.issues.append(
                        ValidationIssue(
                            "E_LATEST_POINTER",
                            content.path,
                            f"{pointer_key}는 {expected_pointer!r}이어야 합니다.",
                        )
                    )
        return report

    def validate_automation_integrity(self) -> ValidationReport:
        report = ValidationReport()
        pipeline_path = self.repository.root / "03_processes" / "longform" / "YOUTUBE_PIPELINE.json"
        report.checked += 1
        try:
            pipeline = json.loads(pipeline_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            report.issues.append(ValidationIssue("E_AUTOMATION_PIPELINE", pipeline_path, f"Pipeline JSON을 읽을 수 없습니다: {exc}"))
            return report

        stages = pipeline.get("stages")
        if not isinstance(stages, list) or not stages:
            report.issues.append(ValidationIssue("E_AUTOMATION_STAGES", pipeline_path, "Pipeline stages는 비어 있지 않은 목록이어야 합니다."))
            return report
        stage_ids = [stage.get("id") for stage in stages if isinstance(stage, dict)]
        if len(stage_ids) != len(stages) or any(not isinstance(stage_id, str) for stage_id in stage_ids) or len(stage_ids) != len(set(stage_ids)):
            report.issues.append(ValidationIssue("E_AUTOMATION_STAGE_ID", pipeline_path, "Automation Stage id는 문자열이며 중복될 수 없습니다."))
            return report
        stage_id_set = set(stage_ids)
        graph: dict[str, list[str]] = {}
        required = {"id", "order", "phase", "label", "source", "owner", "provider", "dependsOn", "inputKeys", "outputs", "qualityChecks", "humanGate"}
        for stage in stages:
            missing = required - set(stage)
            if missing:
                report.issues.append(ValidationIssue("E_AUTOMATION_STAGE_REQUIRED", pipeline_path, f"{stage.get('id')} 필수 값 누락: {sorted(missing)}"))
            dependencies = stage.get("dependsOn")
            if not isinstance(dependencies, list) or any(item not in stage_id_set for item in dependencies):
                report.issues.append(ValidationIssue("E_AUTOMATION_DEPENDENCY", pipeline_path, f"{stage.get('id')}의 dependsOn이 올바르지 않습니다."))
                dependencies = []
            graph[str(stage.get("id"))] = [str(item) for item in dependencies]

        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(stage_id: str) -> bool:
            if stage_id in visiting:
                return False
            if stage_id in visited:
                return True
            visiting.add(stage_id)
            valid = all(visit(dependency) for dependency in graph.get(stage_id, []))
            visiting.remove(stage_id)
            visited.add(stage_id)
            return valid

        if not all(visit(stage_id) for stage_id in stage_ids):
            report.issues.append(ValidationIssue("E_AUTOMATION_CYCLE", pipeline_path, "Automation dependency에 순환이 있습니다."))

        allowed_statuses = {"locked", "ready", "queued", "running", "needs_input", "needs_decision", "blocked", "failed", "completed"}
        state_paths = sorted((self.repository.root / "05_contents").glob("*/**/automation/state.json"))
        for state_path in state_paths:
            report.checked += 1
            try:
                state = json.loads(state_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                report.issues.append(ValidationIssue("E_AUTOMATION_STATE", state_path, f"Automation state를 읽을 수 없습니다: {exc}"))
                continue
            content_id = state.get("contentId")
            if not isinstance(content_id, str) or state_path.parts[-4] != content_id:
                report.issues.append(ValidationIssue("E_AUTOMATION_CONTENT", state_path, "state contentId와 Content 폴더가 일치하지 않습니다."))
            if state.get("pipelineId") != pipeline.get("id") or state.get("currentStageId") not in stage_id_set:
                report.issues.append(ValidationIssue("E_AUTOMATION_STATE_POINTER", state_path, "state의 pipeline 또는 currentStage가 올바르지 않습니다."))
            stage_states = state.get("stages")
            if not isinstance(stage_states, dict) or any(stage_id not in stage_id_set for stage_id in stage_states):
                report.issues.append(ValidationIssue("E_AUTOMATION_STATE_STAGES", state_path, "state에 알 수 없는 Stage가 있습니다."))
                continue
            for stage_id, stage_state in stage_states.items():
                if not isinstance(stage_state, dict) or stage_state.get("status") not in allowed_statuses:
                    report.issues.append(ValidationIssue("E_AUTOMATION_STATE_STATUS", state_path, f"{stage_id} 상태가 올바르지 않습니다."))
            if not isinstance(state.get("questions"), list) or not isinstance(state.get("jobs"), list):
                report.issues.append(ValidationIssue("E_AUTOMATION_STATE_LIST", state_path, "questions와 jobs는 목록이어야 합니다."))
        return report

    @staticmethod
    def _is_timezone_timestamp(value: Any) -> bool:
        if not isinstance(value, str):
            return False
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return False
        return parsed.tzinfo is not None
