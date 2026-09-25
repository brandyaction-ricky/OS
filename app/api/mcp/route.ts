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
      serverInfo: { name: "brandy-os", version: "3.3.0" },
      instructions: "브랜디 OS의 지식·Skill·운영 기록을 검색·관리합니다. 업무 시작 전 list_skills로 적용할 회사 표준이 있는지 확인하고 get_skill로 절차와 품질 기준을 읽으세요. 요청 분류가 필요하면 classify_request를 보조 의견으로 쓸 수 있습니다. 이 도구는 기본 서버 스위치가 꺼져 있으며, 사용자가 현재 요청에서 JEV 외부 처리를 명시적으로 허용한 경우에만 confirm_external_processing=true로 호출하세요. 비밀번호·API 키·연락처 등 민감 정보를 보내지 마세요. 결과는 실행 권한이나 사람 승인을 주지 않습니다. 프로젝트 작업 전 get_project_context로 현재 상태를 읽고, 작업 후 create_development_log로 검증·브랜치·다음 단계를 기록하세요. 새 지식은 개인 초안으로 만들고 모든 수정은 버전·감사를 남기며 삭제는 휴지통 이동만 허용합니다. 권한 변경, 외부 예약·발행, 영구 삭제는 OS에서 사람이 직접 승인해야 합니다. delete 도구는 confirm=true일 때만 호출하세요.",
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
