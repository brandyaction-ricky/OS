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


if __name__ == "__main__":
    raise SystemExit(main())

