#!/usr/bin/env python3
"""브랜디 OS 지식 API를 Claude Code·Codex에 연결하는 stdio MCP 서버."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


def api_base() -> str:
    configured = os.getenv("KNOWLEDGE_API_URL", "").rstrip("/")
    if configured:
        return configured if configured.endswith("/api/v1") else f"{configured}/api/v1"
    return f"{os.getenv('OS_URL', 'http://localhost:3000').rstrip('/')}/api/v1"


API_URL = api_base()
AGENT_PAT = os.getenv("AGENT_PAT", "")
ORG_UUID = os.getenv("ORG_UUID", "")


def require_connection(*, write: bool = False) -> None:
    if not AGENT_PAT:
        raise RuntimeError("AGENT_PAT가 설정되지 않았습니다.")
    if not ORG_UUID:
        raise RuntimeError("ORG_UUID가 설정되지 않았습니다.")
    if write and os.getenv("OS_MCP_READ_ONLY", "").lower() in {"1", "true", "yes"}:
        raise RuntimeError("OS_MCP_READ_ONLY가 켜져 있어 쓰기 도구를 사용할 수 없습니다.")


def api(path: str, *, method: str = "GET", body: dict[str, Any] | None = None) -> dict[str, Any]:
    require_connection()
    payload = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
    request = urllib.request.Request(
        f"{API_URL}{path}",
        data=payload,
        method=method,
        headers={"Authorization": f"Bearer {AGENT_PAT}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")
        raise RuntimeError(f"OS API {error.code}: {detail}") from error


TOOLS = [
    {
        "name": "search_knowledge",
        "description": "브랜디 OS 회사 정본과 이 AI 소유자의 초안에서 관련 근거를 검색합니다.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "minLength": 1},
                "top_k": {"type": "integer", "minimum": 1, "maximum": 20},
                "include_my_drafts": {"type": "boolean", "default": True},
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_document",
        "description": "검색 결과나 쓰기 결과의 문서 원문과 현재 버전을 읽습니다.",
        "inputSchema": {
            "type": "object",
            "properties": {"document_id": {"type": "string", "format": "uuid"}},
            "required": ["document_id"],
        },
    },
    {
        "name": "create_document",
        "description": "새 지식을 개인 초안(personal_draft)으로 만듭니다. 회사 정본으로 바로 만들 수 없습니다.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "minLength": 1},
                "content_md": {"type": "string", "minLength": 1},
                "folder": {"type": "string", "default": "AI 저장/검토 대기"},
                "tags": {"type": "array", "items": {"type": "string"}},
                "reason": {"type": "string"},
            },
            "required": ["title", "content_md"],
        },
    },
    {
        "name": "edit_document",
        "description": "문서를 수정하고 새 버전을 남깁니다. expected_version을 주면 동시 수정 충돌을 감지합니다.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "document_id": {"type": "string", "format": "uuid"},
                "expected_version": {"type": "integer", "minimum": 1},
                "title": {"type": "string", "minLength": 1},
                "content_md": {"type": "string", "minLength": 1},
                "folder": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
                "reason": {"type": "string"},
            },
            "required": ["document_id"],
        },
    },
    {
        "name": "delete_document",
        "description": "문서를 영구 삭제하지 않고 OS 휴지통으로 옮깁니다. confirm=true가 반드시 필요합니다.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "document_id": {"type": "string", "format": "uuid"},
                "confirm": {"type": "boolean"},
                "reason": {"type": "string"},
            },
            "required": ["document_id", "confirm"],
        },
    },
]


def call_tool(name: str, args: dict[str, Any]) -> Any:
    if name == "search_knowledge":
        statuses = ["canonical"]
        if args.get("include_my_drafts", True):
            statuses.extend(["draft", "team", "review", "reviewed"])
        return api("/search", method="POST", body={
            "organizationId": ORG_UUID,
            "query": args["query"],
            "mode": "hybrid",
            "topK": args.get("top_k", 8),
            "filters": {"statuses": statuses},
        })
    if name == "get_document":
        query = urllib.parse.urlencode({"organizationId": ORG_UUID, "documentId": args["document_id"]})
        return api(f"/knowledge-documents?{query}")
    if name == "create_document":
        require_connection(write=True)
        return api("/knowledge-documents", method="POST", body={
            "organizationId": ORG_UUID,
            "title": args["title"],
            "contentMd": args["content_md"],
            "folder": args.get("folder", "AI 저장/검토 대기"),
            "tags": args.get("tags", []),
            "status": "personal_draft",
            "reason": args.get("reason", "MCP 에이전트 생성"),
        })
    if name == "edit_document":
        require_connection(write=True)
        body = {
            "organizationId": ORG_UUID,
            "documentId": args["document_id"],
            "reason": args.get("reason", "MCP 에이전트 수정"),
        }
        field_map = {"expected_version": "expectedVersion", "content_md": "contentMd"}
        for field in ["expected_version", "title", "content_md", "folder", "tags"]:
            if field in args:
                body[field_map.get(field, field)] = args[field]
        return api("/knowledge-documents", method="PATCH", body=body)
    if name == "delete_document":
        require_connection(write=True)
        if args.get("confirm") is not True:
            raise RuntimeError("휴지통 이동에는 confirm=true가 필요합니다.")
        query = urllib.parse.urlencode({
            "organizationId": ORG_UUID,
            "documentId": args["document_id"],
            "reason": args.get("reason", "MCP 에이전트 휴지통 이동"),
        })
        return api(f"/knowledge-documents?{query}", method="DELETE")
    raise RuntimeError(f"알 수 없는 도구: {name}")


def respond(request: dict[str, Any]) -> dict[str, Any] | None:
    method = request.get("method")
    if method == "notifications/initialized":
        return None
    result: Any
    if method == "initialize":
        result = {
            "protocolVersion": "2025-06-18",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "brandy-os-knowledge", "version": "3.0.0"},
        }
    elif method == "tools/list":
        result = {"tools": TOOLS}
    elif method == "tools/call":
        params = request.get("params", {})
        try:
            value = call_tool(params.get("name", ""), params.get("arguments", {}))
            result = {"content": [{"type": "text", "text": json.dumps(value, ensure_ascii=False, indent=2)}]}
        except Exception as error:  # MCP returns tool errors as content without leaking configured secrets.
            result = {"isError": True, "content": [{"type": "text", "text": str(error)}]}
    else:
        return {"jsonrpc": "2.0", "id": request.get("id"), "error": {"code": -32601, "message": "Method not found"}}
    return {"jsonrpc": "2.0", "id": request.get("id"), "result": result}


def main() -> None:
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            response = respond(json.loads(line))
            if response is not None:
                print(json.dumps(response, ensure_ascii=False), flush=True)
        except Exception as error:
            print(json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32603, "message": str(error)}}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
