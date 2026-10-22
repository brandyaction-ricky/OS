import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest, type RequestActor } from "@/lib/server/auth";
import { hashShareToken } from "@/lib/server/document-share";
import { readableKnowledgePages } from "@/lib/server/knowledge-page-access";
import { createServiceSupabase } from "@/lib/supabase/server";

// Document sharing: a personal note shared read-only with named staff, and external links
// that anyone with the address can read until they expire or are revoked.
type ShareDocument = { id: string; owner_id: string; status: string; reader_scope: string; steward_id: string | null };


async function readableDocument(actor: RequestActor, documentId: string) {
  const { data, error } = await createServiceSupabase().from("os_documents")
    .select("id,owner_id,status,reader_scope,steward_id,parent_document_id").eq("id", documentId).maybeSingle();
  if (error) throw new ApiError(503, "SHARE_UNAVAILABLE", "공유 설정을 불러오지 못했습니다.");
  if (!data || !(await readableKnowledgePages(actor, [data])).has(data.id)) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "이 문서를 볼 권한이 없습니다.");
  return data as ShareDocument;
}
// Owner or admin; a canon's steward too. A restricted canon only by an admin. Never from Trash.
function mayLink(actor: RequestActor, doc: ShareDocument) {
  if (doc.status === "archived") return false;
  const admin = actor.role === "admin";
  if (doc.status === "canonical" && doc.reader_scope !== "all") return admin;
  return admin || doc.owner_id === actor.id || doc.status === "canonical" && doc.steward_id === actor.id;
}
async function user(request: Request) {
  const actor = await authenticateRequest(request);
  if (actor.type !== "user") throw new ApiError(403, "USER_SESSION_REQUIRED", "직원 로그인으로 열어 주세요.");
  return actor;
}

export async function GET(request: Request) {
  try {
    const actor = await user(request);
    const documentId = z.string().uuid().safeParse(new URL(request.url).searchParams.get("documentId"));
    if (!documentId.success) throw new ApiError(400, "INVALID_DOCUMENT", "문서를 확인해 주세요.");
    const doc = await readableDocument(actor, documentId.data), service = createServiceSupabase();
    const canShareNote = doc.status === "draft" && doc.owner_id === actor.id, canLink = mayLink(actor, doc);
    const [readers, links] = await Promise.all([
      canShareNote ? service.from("os_document_readers").select("user_id").eq("document_id", doc.id) : Promise.resolve({ data: [], error: null }),
      canLink ? service.from("os_document_share_links").select("id,created_by,created_at,expires_at,revoked_at")
        .eq("document_id", doc.id).order("created_at", { ascending: false }).limit(20) : Promise.resolve({ data: [], error: null }),
    ]);
    if (readers.error || links.error) throw new ApiError(503, "SHARE_UNAVAILABLE", "공유 설정을 불러오지 못했습니다.");
    return NextResponse.json({ canShareNote, canLink, readerIds: (readers.data ?? []).map(row => row.user_id),
      links: (links.data ?? []).map(row => ({ id: row.id, createdBy: row.created_by, createdAt: row.created_at, expiresAt: row.expires_at, revokedAt: row.revoked_at })) },
    { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("readers"), documentId: z.string().uuid(), readerIds: z.array(z.string().uuid()).max(50) }),
  z.object({ action: z.literal("link"), documentId: z.string().uuid(), days: z.union([z.literal(1), z.literal(7), z.literal(30)]) }),
  z.object({ action: z.literal("revoke"), documentId: z.string().uuid(), linkId: z.string().uuid() }),
]);

export async function POST(request: Request) {
  try {
    const actor = await user(request), input = schema.parse(await parseJson(request, 8000));
    const doc = await readableDocument(actor, input.documentId), service = createServiceSupabase();
    if (input.action === "readers") {
      const { error } = await service.rpc("os_share_note_readers", { p_actor: actor.id, p_document: doc.id, p_readers: input.readerIds });
      if (error?.message?.includes("NOTE_SHARE_OWNER_ONLY")) throw new ApiError(403, "NOTE_SHARE_OWNER_ONLY", "내 노트의 작성자만 직원에게 공유할 수 있습니다.");
      if (error?.message?.includes("NOTE_SHARE_DRAFT_ONLY")) throw new ApiError(409, "NOTE_SHARE_DRAFT_ONLY", "내 노트만 지정한 직원에게 공유할 수 있습니다. 팀 문서는 이미 모든 직원이 봅니다.");
      if (error?.message?.includes("READER_INVALID")) throw new ApiError(400, "READER_INVALID", "활성 직원만 선택할 수 있습니다.");
      if (error) throw new ApiError(503, "NOTE_SHARE_FAILED", "공유 설정을 저장하지 못했습니다.");
      return NextResponse.json({ readerIds: input.readerIds });
    }
    if (!mayLink(actor, doc)) throw new ApiError(403, "SHARE_LINK_FORBIDDEN", "외부 공개 링크는 작성자나 관리자만 만들거나 해제할 수 있습니다.");
    if (input.action === "revoke") {
      const { data, error } = await service.from("os_document_share_links").update({ revoked_at: new Date().toISOString(), revoked_by: actor.id })
        .eq("id", input.linkId).eq("document_id", doc.id).is("revoked_at", null).select("id").maybeSingle();
      if (error) throw new ApiError(503, "SHARE_LINK_FAILED", "링크를 해제하지 못했습니다.");
      if (!data) throw new ApiError(404, "SHARE_LINK_NOT_FOUND", "이미 해제했거나 없는 링크입니다.");
      return NextResponse.json({ revoked: true });
    }
    // Only the hash is stored; the address is shown once, now.
    const token = randomBytes(32).toString("base64url"), expiresAt = new Date(Date.now() + input.days * 86_400_000).toISOString();
    const { error } = await service.from("os_document_share_links").insert({ document_id: doc.id, token_hash: hashShareToken(token), created_by: actor.id, expires_at: expiresAt });
    if (error) throw new ApiError(503, "SHARE_LINK_FAILED", "공개 링크를 만들지 못했습니다.");
    return NextResponse.json({ url: `${new URL(request.url).origin}/share/${token}`, expiresAt }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_SHARE", "공유 설정을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
