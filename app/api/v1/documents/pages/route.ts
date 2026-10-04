import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { apiErrorResponse, ApiError, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { normalizeKnowledgeFolder } from "@/lib/knowledge-folders";
import { readableKnowledgePages } from "@/lib/server/knowledge-page-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const movePageSchema = z.object({
  id: z.string().uuid(),
  parentDocumentId: z.string().uuid().nullable(),
  folder: z.string().max(160),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
});

export async function PATCH(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = movePageSchema.parse(await parseJson(request));
    const folder = input.folder.trim() ? normalizeKnowledgeFolder(input.folder) : "";
    const { data: current, error: readError } = await actor.supabase.from("os_documents")
      .select("id,updated_at,status,owner_id,parent_document_id")
      .eq("id", input.id)
      .maybeSingle();
    if (readError || !current) throw new ApiError(404, "PAGE_NOT_FOUND", "페이지를 찾을 수 없습니다.");
    if (!(await readableKnowledgePages(actor, [current])).has(current.id)) throw new ApiError(404, "PAGE_NOT_FOUND", "페이지를 찾을 수 없습니다.");
    if (current.status === "archived") throw new ApiError(409, "PAGE_ARCHIVED", "휴지통 페이지는 이동할 수 없습니다.");
    if (current.updated_at !== input.expectedUpdatedAt) throw new ApiError(409, "PAGE_MOVE_CONFLICT", "다른 변경이 먼저 저장됐습니다. 목록을 새로고침해 주세요.");

    if (input.parentDocumentId) {
      const { data: parent, error: parentError } = await actor.supabase.from("os_documents")
        .select("id,folder,status,owner_id,parent_document_id")
        .eq("id", input.parentDocumentId)
        .maybeSingle();
      if (parentError || !parent || parent.status === "archived") throw new ApiError(404, "PAGE_PARENT_NOT_FOUND", "상위 페이지를 열 수 없습니다.");
      if (!(await readableKnowledgePages(actor, [parent])).has(parent.id)) throw new ApiError(404, "PAGE_PARENT_NOT_FOUND", "상위 페이지를 열 수 없습니다.");
      if (parent.folder !== folder) throw new ApiError(400, "PAGE_FOLDER_MISMATCH", "하위 페이지는 상위 페이지와 같은 폴더에 있어야 합니다.");
    }

    const { data, error } = await actor.supabase.from("os_documents")
      .update({ parent_document_id: input.parentDocumentId, folder })
      .eq("id", input.id)
      .eq("updated_at", input.expectedUpdatedAt)
      .select("*")
      .maybeSingle();
    if (error?.message.includes("OS_PAGE_CYCLE")) throw new ApiError(400, "PAGE_CYCLE", "페이지를 자신이나 하위 페이지 아래로 옮길 수 없습니다.");
    if (error?.message.includes("OS_PAGE_")) throw new ApiError(400, "PAGE_MOVE_INVALID", "상위 페이지와 폴더 위치를 확인해 주세요.");
    if (error) throw new ApiError(400, "PAGE_MOVE_FAILED", "페이지를 옮기지 못했습니다.", error.message);
    if (!data) throw new ApiError(409, "PAGE_MOVE_CONFLICT", "다른 변경이 먼저 저장됐습니다. 목록을 새로고침해 주세요.");
    return NextResponse.json({ document: data });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_PAGE_MOVE", "페이지 이동 내용을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
