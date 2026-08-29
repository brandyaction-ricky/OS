#!/usr/bin/env python3
"""브랜디 OS 지식 API를 직원 AI에 연결하는 표준입출력 MCP 서버."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


OS_URL = os.getenv("OS_URL", "http://localhost:3000").rstrip("/")
AGENT_PAT = os.getenv("AGENT_PAT", "")
OS_USER_JWT = os.getenv("OS_USER_JWT", "")


def api(path: str, *, method: str = "GET", token: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
    request = urllib.request.Request(
        f"{OS_URL}{path}",
        data=payload,
        method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")
        raise RuntimeError(f"OS API {error.code}: {detail}") from error


TOOLS = [
    {
        "name": "search_knowledge",
        "description": "브랜디 OS 회사 정본에서 질문과 관련된 근거 문단을 검색합니다.",
        "inputSchema": {
            "type": "object",
            "properties": {"query": {"type": "string"}, "top_k": {"type": "integer", "minimum": 1, "maximum": 20}},
            "required": ["query"],
        },
    },
    {
        "name": "get_document",
        "description": "검색 결과의 문서 원문을 읽습니다.",
        "inputSchema": {"type": "object", "properties": {"document_id": {"type": "string"}}, "required": ["document_id"]},
    },
    {
        "name": "save_knowledge",
        "description": "사람 계정 권한으로 새 지식을 개인 초안에 저장합니다. OS_USER_JWT가 필요합니다.",
        "inputSchema": {
            "type": "object",
            "properties": {"title": {"type": "string"}, "text": {"type": "string"}, "tags": {"type": "array", "items": {"type": "string"}}},
            "required": ["title", "text"],
        },
    },
]


def call_tool(name: str, args: dict[str, Any]) -> Any:
    if name == "search_knowledge":
        if not AGENT_PAT:
            raise RuntimeError("AGENT_PAT가 설정되지 않았습니다.")
        return api("/api/v1/search", method="POST", token=AGENT_PAT, body={
            "query": args["query"], "mode": "hybrid", "topK": args.get("top_k", 8),
            "filters": {"statuses": ["canonical"]},
        })
    if name == "get_document":
        if not AGENT_PAT:
            raise RuntimeError("AGENT_PAT가 설정되지 않았습니다.")
        document_id = urllib.parse.quote(args["document_id"], safe="")
        return api(f"/api/v1/documents/{document_id}", token=AGENT_PAT)
    if name == "save_knowledge":
        if not OS_USER_JWT:
            raise RuntimeError("저장은 읽기 전용 Agent PAT가 아니라 사람 계정의 OS_USER_JWT가 필요합니다.")
        return api("/api/v1/documents", method="POST", token=OS_USER_JWT, body={
            "title": args["title"], "content": args["text"], "tags": args.get("tags", []),
            "folder": "AI 저장/검토 대기", "source": "decision",
        })
    raise RuntimeError(f"알 수 없는 도구: {name}")


def respond(request: dict[str, Any]) -> dict[str, Any] | None:
    method = request.get("method")
    if method == "notifications/initialized":
        return None
    result: Any
    if method == "initialize":
        result = {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}}, "serverInfo": {"name": "brandy-os-knowledge", "version": "2.0.0"}}
    elif method == "tools/list":
        result = {"tools": TOOLS}
    elif method == "tools/call":
        params = request.get("params", {})
        try:
            value = call_tool(params.get("name", ""), params.get("arguments", {}))
            result = {"content": [{"type": "text", "text": json.dumps(value, ensure_ascii=False, indent=2)}]}
        except Exception as error:  # MCP returns tool errors as content.
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
