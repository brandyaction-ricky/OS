import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { replaceWikiLinkTarget } from "@/lib/knowledge-links";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { readableKnowledgePages } from "@/lib/server/knowledge-page-access";
import { createCanonicalProposal } from "@/lib/server/document-proposals";
import { indexDocument } from "@/lib/server/indexing";

const schema = z.object({
  oldTarget: z.string().trim().min(1).max(300),
  targetId: z.string().uuid(),
  sources: z.array(z.object({ id: z.string().uuid(), expectedVersion: z.number().int().positive() })).min(1).max(50),
});

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = schema.parse(await parseJson(request, 32_000));
    if (new Set(input.sources.map((source) => source.id)).size !== input.sources.length) {
      throw new ApiError(400, "DUPLICATE_SOURCE", "같은 원본 문서를 중복 선택할 수 없습니다.");
    }
    const service = createServiceSupabase();
    const { data: target, error: targetError } = await service.from("os_documents").select("id,title,folder,status,owner_id,parent_document_id")
      .eq("id", input.targetId).maybeSingle();
    if (targetError || !target || !(await readableKnowledgePages(actor, [target])).has(target.id)) {
      throw new ApiError(404, "TARGET_NOT_FOUND", "대상 문서를 열 수 없습니다.");
    }
    if (target.status === "archived") throw new ApiError(409, "TARGET_ARCHIVED", "대상 문서가 휴지통에 있습니다. 먼저 복원해 주세요.");
    const { data: samePath, error: pathError } = await service.from("os_documents").select("id")
      .eq("folder", target.folder).eq("title", target.title).neq("status", "archived");
    if (pathError || (samePath ?? []).length !== 1) throw new ApiError(409, "TARGET_PATH_AMBIGUOUS", "대상의 폴더·제목 경로가 유일하지 않습니다. 문서 이름을 구분해 주세요.");
    const replacement = [target.folder, target.title].filter(Boolean).join("/");
    if (/[\[\]|#]/.test(replacement)) throw new ApiError(409, "TARGET_PATH_UNSAFE", "대상 문서의 경로에 위키 링크 예약 문자가 있습니다. 문서 이름을 조정해 주세요.");
    const { data: aliasCollision, error: aliasError } = await service.from("os_documents").select("id")
      .eq("source_ref", replacement).neq("status", "archived").neq("id", target.id);
    if (aliasError || (aliasCollision ?? []).length) throw new ApiError(409, "TARGET_PATH_AMBIGUOUS", "다른 문서의 원본 경로와 겹칩니다. 문서 이름을 구분해 주세요.");
    const results: Array<{ id: string; outcome: "updated" | "proposal" | "failed"; count?: number; code?: string; message?: string }> = [];
    for (const source of input.sources) {
      try {
        const { data: current, error: currentError } = await service.from("os_documents").select("*").eq("id", source.id).maybeSingle();
        if (currentError || !current || current.status === "archived" || !(await readableKnowledgePages(actor, [current])).has(source.id)) {
          throw new ApiError(404, "SOURCE_NOT_FOUND", "원본 문서를 열 수 없습니다.");
        }
        if (current.current_version !== source.expectedVersion) throw new ApiError(409, "VERSION_CONFLICT", "원본 문서가 먼저 수정됐습니다.");
        const next = replaceWikiLinkTarget(current.content_md, input.oldTarget, replacement);
        if (!next.count) throw new ApiError(409, "LINK_NOT_FOUND", "원본에서 해당 링크를 찾지 못했습니다.");
        if (current.status === "canonical") {
          await createCanonicalProposal(actor, current, source.expectedVersion, {
            title: current.title, content_md: next.content, folder: current.folder,
            brand: current.brand ?? "", team: current.team, tags: current.tags,
          });
          results.push({ id: source.id, outcome: "proposal", count: next.count });
        } else {
          const { data, error } = await actor.supabase.rpc("os_knowledge_command", {p:{action:"document.commit",id:source.id,expectedVersion:source.expectedVersion,title:current.title,content:next.content}});
          if (error?.message?.includes("OS_VERSION_CONFLICT")) throw new ApiError(409, "VERSION_CONFLICT", "원본 문서가 먼저 수정됐습니다.");
          if (error || !data) throw new ApiError(403, "LINK_REPAIR_DENIED", "이 문서의 링크를 수정할 권한이 없습니다.");
          try { await indexDocument(source.id); } catch { /* Saved content remains valid; indexing retries separately. */ }
          results.push({ id: source.id, outcome: "updated", count: next.count });
        }
      } catch (reason) {
        const error = reason instanceof ApiError ? reason : new ApiError(500, "LINK_REPAIR_FAILED", "링크를 고치지 못했습니다.");
        results.push({ id: source.id, outcome: "failed", code: error.code, message: error.message });
      }
    }
    const failed = results.some((result) => result.outcome === "failed");
    return NextResponse.json({ results, partial: failed }, { status: failed ? 207 : 200 });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_LINK_REPAIR", "링크 수정 대상을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
