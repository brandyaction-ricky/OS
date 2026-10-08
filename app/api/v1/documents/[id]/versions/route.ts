import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { apiErrorResponse, ApiError, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { readableKnowledgePages } from "@/lib/server/knowledge-page-access";
import { createCanonicalProposal } from "@/lib/server/document-proposals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const restoreSchema = z.object({
  version: z.number().int().positive(),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().max(500).optional().default(""),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateRequest(request);
    const { id } = await params;
    const service = createServiceSupabase();
    const { data: document, error: documentError } = await service.from("os_documents")
      .select("*").eq("id", id).maybeSingle();
    if (documentError || !document || !(await readableKnowledgePages(actor, [document])).has(id)) {
      throw new ApiError(404, "DOCUMENT_NOT_FOUND", "문서를 찾을 수 없습니다.");
    }
    const query=new URL(request.url).searchParams;
    const page=z.object({limit:z.coerce.number().int().min(1).max(1000),offset:z.coerce.number().int().min(0).max(1_000_000)}).safeParse({limit:query.get("limit")??1000,offset:query.get("offset")??0});
    if(!page.success)throw new ApiError(400,"INVALID_PAGE","버전 페이지 범위를 확인해 주세요.");
    const {limit,offset}=page.data;
    const { data, error } = await service.from("os_document_versions").select("version_no,title,content_md,author_id,agent_key_id,reason,created_at").eq("document_id", id).order("version_no", { ascending: false }).range(offset,offset+limit-1);
    if (error) throw new ApiError(400, "DOCUMENT_VERSIONS_FAILED", "변경 이력을 불러오지 못했습니다.", error.message);
    const authorIds = [...new Set((data ?? []).map((version) => version.author_id).filter(Boolean))];
    const { data: authors } = authorIds.length ? await service.from("os_profiles").select("id,display_name,email").in("id", authorIds) : { data: [] };
    const agentIds = [...new Set((data ?? []).map((version) => version.agent_key_id).filter(Boolean))];
    const { data: agents } = agentIds.length ? await service.from("os_agent_keys").select("id,name").in("id", agentIds) : { data: [] };
    const names = new Map((authors ?? []).map((author) => [author.id, author.display_name || author.email || "초기 가져오기"]));
    const agentNames = new Map((agents ?? []).map((agent) => [agent.id, agent.name]));
    return NextResponse.json({ versions: (data ?? []).map((version) => ({
      ...version,
      author_name: version.agent_key_id
        ? `${agentNames.get(version.agent_key_id) ?? "AI 에이전트"} · AI`
        : version.author_id ? names.get(version.author_id) ?? "구성원" : "초기 가져오기",
    })), hasMore:(data??[]).length===limit },{headers:{"Cache-Control":"private, no-store"}});
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateRequest(request);
    const { id } = await params;
    const { data: document, error: documentError } = await createServiceSupabase().from("os_documents")
      .select("*").eq("id", id).maybeSingle();
    if (documentError || !document || !(await readableKnowledgePages(actor, [document])).has(id)) {
      throw new ApiError(404, "DOCUMENT_NOT_FOUND", "문서를 찾을 수 없습니다.");
    }
    const input = restoreSchema.parse(await parseJson(request, 16_000));
    if (document.status === "canonical") {
      const { data: version, error: versionError } = await createServiceSupabase().from("os_document_versions")
        .select("title,content_md").eq("document_id", id).eq("version_no", input.version).maybeSingle();
      if (versionError || !version) throw new ApiError(404, "VERSION_NOT_FOUND", "되돌릴 버전을 찾을 수 없습니다.");
      const proposal = await createCanonicalProposal(actor, document, input.expectedVersion, {
        title: version.title, content_md: version.content_md, folder: document.folder,
        brand: document.brand ?? "", team: document.team, tags: document.tags,
      }, input.reason);
      return NextResponse.json({ document, proposal }, { status: 202 });
    }
    const { data, error } = await actor.supabase.rpc("os_restore_document_version", {
      p_document_id: id,
      p_version_no: input.version,
      p_expected_version: input.expectedVersion,
      p_reason: input.reason,
    });
    if (error?.message?.startsWith("OS_VERSION_CONFLICT:")) throw new ApiError(409, "VERSION_CONFLICT", "다른 사람이 먼저 수정했습니다. 최신 버전을 확인하고 다시 시도해 주세요.");
    if (error) throw new ApiError(400, "DOCUMENT_RESTORE_FAILED", "이 버전으로 되돌리지 못했습니다.", error.message);
    return NextResponse.json({ document: data });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_VERSION", "되돌릴 버전을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
