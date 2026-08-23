from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from . import __version__
from .errors import BAError
from .operations import BAService
from .repository import Repository
from .util import format_table


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ba",
        description="BrandyAction OS local workspace CLI",
    )
    parser.add_argument("--version", action="version", version=f"ba {__version__}")
    subparsers = parser.add_subparsers(dest="command", required=True)

    status_parser = subparsers.add_parser("status", help="전체 또는 특정 Content Run 상태 확인")
    status_parser.add_argument("content_id", nargs="?")
    status_parser.add_argument("--json", action="store_true", dest="as_json")

    setup_parser = subparsers.add_parser("setup", help="이 컴퓨터의 작업자와 Git 설정 초기화")
    setup_parser.add_argument("--user", help="OS에 기록할 작업자 이름")
    setup_parser.add_argument("--email", help="Git commit에 사용할 이메일")

    doctor_parser = subparsers.add_parser("doctor", help="설치·Git·저장소 상태 한 번에 점검")
    doctor_parser.add_argument("--offline", action="store_true")
    doctor_parser.add_argument("--json", action="store_true", dest="as_json")

    subparsers.add_parser("sync", help="GitHub의 최신 OS 상태를 안전하게 받기")

    guide_parser = subparsers.add_parser("guide", help="지금 해야 할 다음 행동 안내")
    guide_parser.add_argument("content_id", nargs="?")

    pull_parser = subparsers.add_parser("pull", help="업무 Context를 로컬 Workspace로 가져오기")
    pull_parser.add_argument("content_id")
    pull_parser.add_argument("--step")
    pull_parser.add_argument("--force", action="store_true")
    pull_parser.add_argument("--offline", action="store_true")
    pull_parser.add_argument("--by")

    skill_parser = subparsers.add_parser("skill", help="Workspace에 Skill 연결 또는 갱신")
    skill_parser.add_argument("content_id")
    skill_parser.add_argument("skill_id", nargs="?")
    skill_parser.add_argument("--json", action="store_true", dest="as_json")

    push_parser = subparsers.add_parser("push", help="검증된 Output을 OS 저장소에 반영")
    push_parser.add_argument("content_id")
    push_parser.add_argument("--step")
    push_parser.add_argument("--offline", action="store_true")
    push_parser.add_argument("--by")

    validate_parser = subparsers.add_parser("validate", help="Frontmatter와 저장소 무결성 검사")
    validate_parser.add_argument("paths", nargs="*", type=Path)
    validate_parser.add_argument("--json", action="store_true", dest="as_json")

    new_parser = subparsers.add_parser("new", help="새 Entity 생성")
    new_subparsers = new_parser.add_subparsers(dest="new_entity", required=True)
    content_parser = new_subparsers.add_parser("content", help="새 Content Run 생성")
    content_parser.add_argument("--type", required=True, dest="content_type")
    content_parser.add_argument("--title")
    content_parser.add_argument("--owner")
    content_parser.add_argument("--id", dest="content_id")
    content_parser.add_argument("--offline", action="store_true")
    content_parser.add_argument("--by")

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        repository = Repository.discover()
        service = BAService(repository)
        if args.command == "setup":
            user = args.user
            if not user:
                try:
                    user = input("OS에서 사용할 작업자 이름을 입력하세요 (예: ricky): ").strip()
                except EOFError as exc:
                    raise BAError(
                        "E_ACTOR",
                        "작업자 이름을 입력받을 수 없습니다.",
                        hint="ba setup --user ricky 형식으로 실행하세요.",
                    ) from exc
            result = service.setup(user, args.email)
            print("초기 설정이 완료되었습니다.")
            print(f"작업자 : {result.user}")
            print(f"이메일 : {result.email}")
            print(f"설정   : {result.config_path}")
            print(f"Git    : {'설정 완료' if result.git_configured else 'Git 저장소 아님'}")
            print("\n다음 명령: ba doctor")
            return 0

        if args.command == "doctor":
            result = service.doctor(offline=args.offline)
            if args.as_json:
                print_json(result)
            else:
                print_doctor(result)
            return 0 if result["healthy"] else 1

        if args.command == "sync":
            result = service.sync()
            if result["updated"]:
                print(f"최신화 완료: {result['before'][:7]} → {result['after'][:7]}")
            else:
                print(f"이미 최신 상태입니다: {result['after'][:7]}")
            print(f"원격 브랜치: {result['upstream']}")
            return 0

        if args.command == "guide":
            print_guide(service, repository, args.content_id)
            return 0

        if args.command == "status":
            result = service.status(args.content_id)
            if args.as_json:
                print_json(result)
            elif args.content_id:
                print_status_detail(result)
            else:
                print_status_list(result)
            return 0

        if args.command == "pull":
            result = service.pull(
                args.content_id,
                step_id=args.step,
                force=args.force,
                offline=args.offline,
                by=args.by,
            )
            print(f"Pulled  : {result.content_id} / {result.step}")
            print(f"Workspace: {result.workspace}")
            print(f"Inputs  : {len(result.inputs)}")
            print(f"Skill   : {result.skill_id or 'human-only'}")
            print("Outputs : " + ", ".join(Path(path).name for path in result.outputs))
            return 0

        if args.command == "skill":
            result = service.skill(args.content_id, args.skill_id)
            if args.as_json:
                print_json(result)
            else:
                print(
                    f"Skill ready: {result['skill_id']} v{result['version']} "
                    f"→ {result['path']}"
                )
            return 0

        if args.command == "push":
            result = service.push(
                args.content_id,
                step_id=args.step,
                offline=args.offline,
                by=args.by,
            )
            prefix = "Push resumed" if result.resumed else "Pushed"
            print(f"{prefix}: {result.content_id} / {result.step}")
            print("Files  : " + ", ".join(path.name for path in result.files))
            print(f"Complete: {'yes' if result.completed else 'no'}")
            print(f"Next   : {result.next_step or '-'}")
            print(f"Commit : {result.commit or 'not-a-git-repository'}")
            print(f"Remote : {'pushed' if result.remote_pushed else 'local only'}")
            return 0

        if args.command == "validate":
            report = service.validate(args.paths or None)
            if args.as_json:
                print_json(
                    {
                        "valid": report.valid,
                        "checked": report.checked,
                        "issues": [
                            issue.as_dict(repository.root) for issue in report.issues
                        ],
                    }
                )
            else:
                if report.valid:
                    print(f"VALID: {report.checked} files checked")
                else:
                    print(f"INVALID: {len(report.issues)} issues in {report.checked} checks")
                    for issue in report.issues:
                        try:
                            path = issue.path.resolve().relative_to(repository.root)
                        except ValueError:
                            path = issue.path
                        print(f"- [{issue.code}] {path}: {issue.message}")
            return 0 if report.valid else 1

        if args.command == "new" and args.new_entity == "content":
            result = service.new_content(
                content_type=args.content_type,
                title=args.title,
                owner=args.owner,
                content_id=args.content_id,
                offline=args.offline,
                by=args.by,
            )
            print(f"Created: {result.content_id}")
            print(f"Path   : {result.path}")
            print(f"Commit : {result.commit or 'not-a-git-repository'}")
            print(f"Remote : {'pushed' if result.remote_pushed else 'local only'}")
            return 0

        parser.error("지원하지 않는 명령입니다.")
        return 2
    except BAError as exc:
        print(exc.render(), file=sys.stderr)
        return exc.exit_code
    except KeyboardInterrupt:
        print("중단되었습니다.", file=sys.stderr)
        return 130


def print_json(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2, default=str))


def print_status_list(result: dict[str, Any]) -> None:
    rows = [
        [
            item.get("id"),
            item.get("type"),
            item.get("current_step"),
            item.get("status"),
            item.get("owner"),
            item.get("next_action"),
        ]
        for item in result.get("items", [])
    ]
    if not rows:
        print("Content Run이 없습니다.")
        return
    print(format_table(["ID", "TYPE", "STEP", "STATUS", "OWNER", "NEXT ACTION"], rows))


def print_status_detail(result: dict[str, Any]) -> None:
    content = result["content"]
    print(f"{content.get('id')} · {content.get('title')}")
    print(
        f"Status: {content.get('status')}  Current: {content.get('current_step')}  "
        f"Owner: {content.get('owner')}"
    )
    print(f"Next  : {content.get('next_action')}")
    print(f"Workspace: {result.get('workspace_state') or '-'}")
    rows = [
        [
            step.get("order"),
            step.get("label"),
            step.get("id"),
            step.get("status"),
            step.get("owner"),
            ", ".join(
                f"{output.get('key')}={output.get('pointer') or '-'}"
                for output in step.get("outputs", [])
            ),
        ]
        for step in result.get("steps", [])
    ]
    print()
    print(format_table(["#", "LABEL", "STEP", "STATUS", "OWNER", "LATEST"], rows))


def print_doctor(result: dict[str, Any]) -> None:
    labels = {"pass": "정상", "warn": "확인", "fail": "오류"}
    rows = [
        [labels.get(check["level"], check["level"]), check["name"], check["message"]]
        for check in result["checks"]
    ]
    print(format_table(["결과", "항목", "내용"], rows))
    print()
    if result["healthy"]:
        print("사용 준비가 완료되었습니다. 다음 명령: ba guide")
    else:
        print("오류 항목을 해결한 뒤 ba doctor를 다시 실행하세요.")


def print_guide(
    service: BAService,
    repository: Repository,
    content_id: str | None,
) -> None:
    if not content_id:
        print("BrandyAction OS는 아래 순서만 기억하면 됩니다.\n")
        print("1. 최신화  : ba sync")
        print("2. 현황확인: ba status")
        print("3. 작업준비: ba pull CONTENT_ID")
        print("4. 실제작업: .workspace/CONTENT_ID/output/ 파일 수정")
        print("5. 결과반영: ba push CONTENT_ID")
        print("\n특정 콘텐츠의 다음 행동: ba guide BA-0268")
        return

    result = service.status(content_id)
    content = result["content"]
    current_step = str(content.get("current_step"))
    workspace_state = result.get("workspace_state")
    print(f"{content_id} · {content.get('title')}")
    print(f"현재 단계: {current_step} / 상태: {content.get('status')}")
    print(f"담당자   : {content.get('owner')}")
    print(f"할 일    : {content.get('next_action')}")
    print()

    workspace = repository.workspace_path(content_id)
    if workspace_state == "working":
        outputs = sorted((workspace / "output").glob("*.md"))
        print("지금은 작업 중입니다.")
        for output in outputs:
            print(f"- 수정할 파일: {output}")
        if (workspace / "SKILL.md").is_file():
            print(f"- 작업 방법: {workspace / 'SKILL.md'}")
        print("\n작업 결과를 저장한 뒤 실행:")
        print(f"ba push {content_id} --step {current_step}")
        return

    print("다음 명령:")
    print(f"ba pull {content_id}")
    print(f"\nPull 후 다시 확인: ba guide {content_id}")


if __name__ == "__main__":
    raise SystemExit(main())
