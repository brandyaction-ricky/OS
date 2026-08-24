from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from brandyaction_os.errors import BAError
from brandyaction_os.frontmatter import read_document, write_document
from brandyaction_os.operations import BAService
from brandyaction_os.repository import Repository


class WorkflowTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.repo_path = Path(self.temporary.name) / "brandyaction-os"
        shutil.copytree(
            PROJECT_ROOT,
            self.repo_path,
            ignore=shutil.ignore_patterns(
                ".git",
                ".workspace",
                "__pycache__",
                "*.pyc",
                "*.egg-info",
            ),
        )
        # 운영 Repository에는 실제 제출본이 있을 수 있다. Workflow 테스트는
        # 항상 edit 단계의 제출 전 상태에서 시작하는 독립 Fixture를 사용한다.
        fixture_edit = self.repo_path / "05_contents" / "BA-0268" / "05_edit" / "edit_v1.md"
        fixture_edit.unlink(missing_ok=True)
        fixture_content_path = self.repo_path / "05_contents" / "BA-0268" / "CONTENT.md"
        fixture_content = read_document(fixture_content_path)
        fixture_content.metadata.update({
            "status": "in_progress",
            "current_step": "edit",
            "owner": "jay",
            "next_owner": "ricky",
            "edit_status": "ready",
            "latest_edit": None,
            "next_action": "편집 1차본과 XML 등록",
        })
        write_document(fixture_content_path, fixture_content.metadata, fixture_content.body)
        self._git("init", "-b", "main")
        self._git("add", ".")
        self._git(
            "-c",
            "user.name=fixture",
            "-c",
            "user.email=fixture@brandyaction.local",
            "commit",
            "-m",
            "fixture",
        )
        self.repository = Repository(self.repo_path)
        self.service = BAService(self.repository)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _git(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", *arguments],
            cwd=self.repo_path,
            check=True,
            text=True,
            capture_output=True,
        )

    def test_repository_is_valid(self) -> None:
        report = self.service.validate()
        self.assertTrue(report.valid, [issue.message for issue in report.issues])

    def test_automation_result_is_valid_without_artifact_latest_flag(self) -> None:
        result_path = self.repo_path / "05_contents" / "BA-0268" / "05_edit" / "automation" / "results" / "shortform_plan_v1.md"
        result_path.parent.mkdir(parents=True, exist_ok=True)
        result_path.write_text(
            """---
schema_version: "1.0"
id: BA-0268-shortform_plan-run-1
entity_type: automation_result
content_id: BA-0268
pipeline_id: youtube-production-v2
stage_id: shortform_plan
status: completed
owner: jay
provider: openai
version: 1
created_at: 2026-08-24T06:00:00+00:00
updated_at: 2026-08-24T06:00:00+00:00
updated_by: jay
---

# 자막 검수·정리

완료
""",
            encoding="utf-8",
        )
        report = self.service.validate()
        self.assertTrue(report.valid, [issue.message for issue in report.issues])
        approved_source = result_path.read_text(encoding="utf-8").replace("status: completed", "status: approved")
        result_path.write_text(approved_source, encoding="utf-8")
        approved_report = self.service.validate()
        self.assertTrue(approved_report.valid, [issue.message for issue in approved_report.issues])

    def test_setup_and_doctor(self) -> None:
        setup = self.service.setup("ricky", "ricky@example.com")
        self.assertEqual(setup.user, "ricky")
        self.assertTrue(setup.git_configured)
        self.assertTrue(setup.config_path.is_file())
        self.assertEqual(self.service.actor(), "ricky")

        doctor = self.service.doctor(offline=True)
        self.assertTrue(doctor["healthy"], doctor["checks"])
        levels = {item["name"]: item["level"] for item in doctor["checks"]}
        self.assertEqual(levels["작업자 설정"], "pass")
        self.assertEqual(levels["Markdown 검사"], "pass")

    def test_guide_explains_next_action(self) -> None:
        result = subprocess.run(
            [str(self.repo_path / "bin" / "ba"), "guide", "BA-0268"],
            cwd=self.repo_path,
            check=False,
            text=True,
            capture_output=True,
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("현재 단계: edit", result.stdout)
        self.assertIn("ba pull BA-0268", result.stdout)

    def test_sync_requires_upstream(self) -> None:
        with self.assertRaises(BAError) as captured:
            self.service.sync()
        self.assertEqual(captured.exception.code, "E_GIT_UPSTREAM")

    def test_bin_wrapper_discovers_repo_outside_working_directory(self) -> None:
        result = subprocess.run(
            [str(self.repo_path / "bin" / "ba"), "status"],
            cwd=Path(self.temporary.name),
            check=False,
            text=True,
            capture_output=True,
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("BA-0268", result.stdout)

    def test_pull_skill_and_completed_push(self) -> None:
        result = self.service.pull("BA-0268", offline=True, by="jay")
        self.assertEqual(result.step, "edit")
        self.assertEqual(result.skill_id, "brandyaction-video-ppt")
        self.assertTrue((result.workspace / "CONTEXT.md").is_file())
        self.assertTrue((result.workspace / "SKILL.md").is_file())
        self.assertTrue((result.workspace / "input" / "latest_shoot" / "shoot_v1.md").is_file())

        skill = self.service.skill("BA-0268", "brandyaction-video-ppt")
        self.assertEqual(skill["version"], "3.1")

        output = result.workspace / "output" / "edit_v1.md"
        document = read_document(output)
        document.metadata["status"] = "approved"
        document.metadata["approval_status"] = "approved"
        document.metadata["ai_used"] = True
        document.metadata["ai_provider"] = "codex"
        write_document(output, document.metadata, "# Edit Asset Manifest\n\nasset_id: BA-0268-edit-v1\n")

        pushed = self.service.push("BA-0268", step_id="edit", offline=True, by="jay")
        self.assertTrue(pushed.completed)
        self.assertEqual(pushed.next_step, "thumbnail")
        self.assertIsNotNone(pushed.commit)
        self.assertTrue((self.repo_path / "05_contents" / "BA-0268" / "05_edit" / "edit_v1.md").is_file())

        content = read_document(self.repo_path / "05_contents" / "BA-0268" / "CONTENT.md")
        self.assertEqual(content.metadata["current_step"], "thumbnail")
        self.assertEqual(content.metadata["edit_status"], "approved")
        self.assertEqual(content.metadata["thumbnail_status"], "ready")
        self.assertEqual(content.metadata["latest_edit"], "05_edit/edit_v1.md")
        self.assertEqual(content.metadata["latest_master"], "05_edit/edit_v1.md")
        self.assertTrue(self.service.validate().valid)

    def test_push_blocks_stale_workspace(self) -> None:
        result = self.service.pull("BA-0268", offline=True, by="jay")
        content_path = self.repo_path / "05_contents" / "BA-0268" / "CONTENT.md"
        content = read_document(content_path)
        content.metadata["next_action"] = "외부 변경"
        write_document(content_path, content.metadata, content.body)

        with self.assertRaises(BAError) as captured:
            self.service.push("BA-0268", offline=True, by="jay")
        self.assertEqual(captured.exception.code, "E_WORKSPACE_STALE")
        self.assertFalse((self.repo_path / "05_contents" / "BA-0268" / "05_edit" / "edit_v1.md").exists())
        self.assertTrue((result.workspace / "output" / "edit_v1.md").is_file())

    def test_review_round_creates_new_version_from_latest_body(self) -> None:
        first = self.service.pull("BA-0268", offline=True, by="jay")
        output = first.workspace / "output" / "edit_v1.md"
        document = read_document(output)
        document.metadata["status"] = "waiting_approval"
        document.metadata["approval_status"] = "pending"
        body = "# Edit v1\n\n검수할 편집 자산입니다.\n"
        write_document(output, document.metadata, body)

        pushed = self.service.push("BA-0268", offline=True, by="jay")
        self.assertFalse(pushed.completed)
        content = read_document(self.repo_path / "05_contents" / "BA-0268" / "CONTENT.md")
        self.assertEqual(content.metadata["edit_status"], "waiting_approval")

        second = self.service.pull("BA-0268", offline=True, by="ricky")
        next_output = second.workspace / "output" / "edit_v2.md"
        next_document = read_document(next_output)
        self.assertEqual(next_document.metadata["parent_id"], "BA-0268-edit-v1")
        self.assertIn("검수할 편집 자산입니다.", next_document.body)
        self.assertEqual(next_document.metadata["approval_status"], "pending")

    def test_new_longform_content(self) -> None:
        result = self.service.new_content(
            content_type="longform",
            title="새 롱폼 테스트",
            offline=True,
            by="ricky",
        )
        self.assertEqual(result.content_id, "BA-0269")
        content = read_document(result.path / "CONTENT.md")
        self.assertEqual(content.metadata["current_step"], "package")
        self.assertEqual(content.metadata["package_status"], "ready")
        self.assertEqual(content.metadata["metrics_status"], "locked")
        for index, folder in enumerate(
            [
                "01_package",
                "02_axis",
                "03_script",
                "04_shoot",
                "05_edit",
                "06_thumbnail",
                "07_approval",
                "08_publish",
                "09_metrics",
            ],
            start=1,
        ):
            with self.subTest(index=index):
                self.assertTrue((result.path / folder).is_dir())
        self.assertTrue(self.service.validate().valid)


if __name__ == "__main__":
    os.environ.setdefault("BA_USER", "test-user")
    unittest.main()
