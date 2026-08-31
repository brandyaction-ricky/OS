import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { MCP_TOOLS, callMcpTool } from "@/lib/server/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const protocolVersion = "2025-06-18";
const organizationIdSchema = z.string().uuid();
const rpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string().min(1),
  params: z.unknown().optional(),
}).passthrough();

function jsonRpc(id: string | number | null | undefined, result: unknown, status = 200) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result }, {
    status,
    headers: { "MCP-Protocol-Version": protocolVersion, "Cache-Control": "no-store" },
  });
}

function jsonRpcError(id: string | number | null | undefined, code: number, message: string, status = 200) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, {
    status,
    headers: { "MCP-Protocol-Version": protocolVersion, "Cache-Control": "no-store" },
  });
}

function toolError(id: string | number | null | undefined, error: unknown) {
  let message = "도구 실행에 실패했습니다.";
  if (error instanceof ZodError) message = "도구 입력값을 확인해 주세요.";
  else if (error instanceof Error && !/bos_pat_|Bearer\s+/i.test(error.message)) message = error.message.slice(0, 1_000);
  return jsonRpc(id, { isError: true, content: [{ type: "text", text: message }] });
}

export async function POST(request: Request) {
  let body: z.infer<typeof rpcRequestSchema>;
  try {
    body = rpcRequestSchema.parse(await request.json());
  } catch {
    return jsonRpcError(null, -32700, "유효한 JSON-RPC 요청이 필요합니다.", 400);
  }

  if (body.method === "initialize") {
    return jsonRpc(body.id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "brandy-os-knowledge", version: "3.1.0" },
      instructions: "브랜디 OS의 회사 정본과 해당 키 소유자의 초안을 검색·관리합니다. 새 문서는 개인 초안으로만 만들고, 수정은 버전을 남기며, 삭제는 영구 삭제가 아닌 휴지통 이동입니다. 쓰기 전 사용자 의도를 확인하고 delete_document는 confirm=true일 때만 호출하세요.",
    });
  }
  if (body.method === "notifications/initialized") return new NextResponse(null, { status: 202 });
  if (body.method === "ping") return jsonRpc(body.id, {});
  if (body.method === "tools/list") return jsonRpc(body.id, { tools: MCP_TOOLS });
  if (body.method !== "tools/call") return jsonRpcError(body.id, -32601, "지원하지 않는 MCP 메서드입니다.");

  try {
    const organizationId = organizationIdSchema.parse(new URL(request.url).searchParams.get("organizationId"));
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer bos_pat_")) return jsonRpcError(body.id, -32001, "유효한 AI 접근 키가 필요합니다.", 401);
    const params = z.object({ name: z.string().min(1), arguments: z.unknown().optional() }).parse(body.params);
    const fetchApi = async (path: string, init: RequestInit = {}) => {
      const response = await fetch(new URL(path, request.url), {
        ...init,
        headers: { Authorization: authorization, "Content-Type": "application/json", ...(init.headers ?? {}) },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({ error: { message: "OS API 응답을 읽지 못했습니다." } }));
      if (!response.ok) {
        const safeMessage = typeof payload?.error?.message === "string" ? payload.error.message : `OS API ${response.status}`;
        throw new Error(safeMessage);
      }
      return payload;
    };
    const value = await callMcpTool(params, organizationId, fetchApi);
    return jsonRpc(body.id, { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
  } catch (error) {
    return toolError(body.id, error);
  }
}

export async function GET() {
  return NextResponse.json({
    name: "Brandy OS MCP",
    transport: "streamable-http",
    protocolVersion,
    authentication: "bearer",
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE() {
  return new NextResponse(null, { status: 204 });
}
