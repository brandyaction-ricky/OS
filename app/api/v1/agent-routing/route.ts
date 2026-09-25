import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { assertOrganization } from "@/lib/server/organization";
import { canonicalSkillRegistryDocumentId, classifyAgentRequest, hasSensitiveRoutingInput, isAgentRequestRoutingEnabled, parseCanonicalAgentRoutes } from "@/lib/server/agent-routing";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  organizationId: z.string().uuid(),
  requestText: z.string().trim().min(1).max(8_000),
  confirmExternalProcessing: z.literal(true),
}).strict();

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request, { allowAgent: true, requiredAgentScope: "knowledge.read" });
    const input = requestSchema.parse(await request.json());
    await assertOrganization(actor, input.organizationId);
    if (!isAgentRequestRoutingEnabled(process.env)) {
      throw new ApiError(503, "AGENT_ROUTE_DISABLED", "요청 분류 기능은 서버에서 아직 사용할 수 없도록 설정되어 있습니다.");
    }
    if (hasSensitiveRoutingInput(input.requestText)) {
      throw new ApiError(422, "AGENT_ROUTE_SENSITIVE_INPUT", "요청문에 개인정보나 비밀값이 포함된 것으로 보여 JEV에 보내지 않았습니다. 민감한 내용을 제거하거나 사람에게 넘겨 주세요.");
    }

    const service = createServiceSupabase();
    const { data, error } = await service.from("os_documents")
      .select("id,status,content_md")
      .eq("id", canonicalSkillRegistryDocumentId)
      .maybeSingle();
    if (error || !data || data.status !== "canonical") {
      throw new ApiError(503, "AGENT_ROUTE_REGISTRY_UNAVAILABLE", "현재 OS 에이전트 기준을 확인하지 못했습니다. 사람에게 넘겨 주세요.");
    }
    const routes = parseCanonicalAgentRoutes(String(data.content_md ?? ""));
    if (routes.length === 0) {
      throw new ApiError(503, "AGENT_ROUTE_REGISTRY_INVALID", "OS 업무 라우팅 표에서 담당 절차를 확인하지 못했습니다. 사람에게 넘겨 주세요.");
    }
    const documentIds = [...new Set(routes.map((route) => route.documentId))];
    const { data: references, error: referenceError } = await service.from("os_documents")
      .select("id,title,status,folder")
      .in("id", documentIds);
    if (referenceError || !references || references.length !== documentIds.length) {
      throw new ApiError(503, "AGENT_ROUTE_REFERENCE_UNAVAILABLE", "담당 절차 문서의 현재 상태를 확인하지 못했습니다. 사람에게 넘겨 주세요.");
    }
    const referenceById = new Map(references.map((reference) => [String(reference.id), reference]));
    const resolvedRoutes = routes.flatMap((route) => {
      const reference = referenceById.get(route.documentId);
      if (reference?.status !== "canonical") return [];
      return [{
        ...route,
        documentTitle: String(reference.title ?? ""),
        documentStatus: "canonical",
        documentFolder: String(reference.folder ?? ""),
      }];
    });
    if (resolvedRoutes.length === 0) {
      throw new ApiError(503, "AGENT_ROUTE_NO_CANONICAL_REFERENCES", "현재 담당 연결에서 적용할 회사 정본을 확인하지 못했습니다. 사람에게 넘겨 주세요.");
    }

    let advice;
    try {
      advice = await classifyAgentRequest(input.requestText, resolvedRoutes);
    } catch {
      throw new ApiError(503, "AGENT_ROUTE_CLASSIFICATION_UNAVAILABLE", "분류 의견을 확인하지 못했습니다. 기존 권한 정책은 그대로이며 사람에게 넘겨 주세요.");
    }
    return NextResponse.json({ advice }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_AGENT_ROUTE_REQUEST", "요청 내용과 외부 처리 확인을 점검해 주세요."));
    return apiErrorResponse(error);
  }
}
