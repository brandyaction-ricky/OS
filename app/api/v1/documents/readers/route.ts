import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

// Who may read a restricted canonical document. Admins only, like the steward setting.
async function admin(request: Request) {
  const actor = await authenticateRequest(request);
  if (actor.type !== "user" || actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 정본 열람 범위를 정할 수 있습니다.");
  return actor;
}

export async function GET(request: Request) {
  try {
    await admin(request);
    const documentId = z.string().uuid().safeParse(new URL(request.url).searchParams.get("documentId"));
    if (!documentId.success) throw new ApiError(400, "INVALID_DOCUMENT", "문서를 확인해 주세요.");
    const service = createServiceSupabase();
    const [document, readers] = await Promise.all([
      service.from("os_documents").select("id,reader_scope,current_version,status").eq("id", documentId.data).maybeSingle(),
      service.from("os_document_readers").select("user_id").eq("document_id", documentId.data),
    ]);
    if (document.error || readers.error) throw new ApiError(503, "READERS_UNAVAILABLE", "열람 범위를 불러오지 못했습니다.");
    if (!document.data || document.data.status !== "canonical") throw new ApiError(404, "DOCUMENT_NOT_FOUND", "회사 정본을 찾을 수 없습니다.");
    return NextResponse.json({ scope: document.data.reader_scope, readerIds: (readers.data ?? []).map(row => row.user_id), currentVersion: document.data.current_version },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

const schema = z.object({ documentId: z.string().uuid(), expectedVersion: z.number().int().positive(), scope: z.enum(["all", "restricted"]), readerIds: z.array(z.string().uuid()).max(200) });

export async function PUT(request: Request) {
  try {
    const actor = await admin(request);
    const input = schema.parse(await parseJson(request, 16000));
    const { data, error } = await createServiceSupabase().rpc("os_set_document_readers", {
      p_actor: actor.id, p_document: input.documentId, p_expected_version: input.expectedVersion, p_scope: input.scope, p_readers: input.readerIds,
    });
    if (error?.message?.includes("VERSION_CONFLICT")) throw new ApiError(409, "VERSION_CONFLICT", "문서가 먼저 변경됐습니다. 새로고침 후 다시 정해 주세요.");
    if (error?.message?.includes("READER_INVALID")) throw new ApiError(400, "READER_INVALID", "활성 구성원만 열람자로 지정할 수 있습니다.");
    if (error?.code === "42883" || error?.code === "PGRST202") throw new ApiError(503, "READERS_SETUP_PENDING", "열람 범위 기능을 DB에 먼저 적용해야 합니다.");
    if (error || !data) throw new ApiError(400, "READERS_UPDATE_FAILED", "열람 범위를 저장하지 못했습니다.");
    return NextResponse.json({ scope: input.scope, readerIds: input.scope === "all" ? [] : input.readerIds });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_READERS", "열람 범위를 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
