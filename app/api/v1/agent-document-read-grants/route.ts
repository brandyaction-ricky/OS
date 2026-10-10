import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { getDefaultOrganization } from "@/lib/server/organization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const id = z.string().uuid();
const grantSchema = z.object({
  documentId: id,
  agentKeyId: id,
  duration: z.enum(["24h", "7d", "ongoing"]),
  reason: z.string().trim().min(1).max(500),
});
const revokeSchema = z.object({ documentId: id, agentKeyId: id });

async function ownedDraft(actorId: string, documentId: string) {
  const { data, error } = await createServiceSupabase().from("os_documents")
    .select("id,owner_id,status,meeting_record_id").eq("id", documentId).maybeSingle();
  if (error) throw new ApiError(503, "AGENT_DOCUMENT_GRANT_UNAVAILABLE", "문서 권한을 확인하지 못했습니다.");
  if (!data || data.owner_id !== actorId || data.status !== "draft" || data.meeting_record_id) {
    throw new ApiError(403, "AGENT_DOCUMENT_GRANT_DENIED", "내 개인 문서에만 AI 읽기를 허용할 수 있습니다.");
  }
}

function grantError(error: {code?: string} | null) {
  if (["42P01", "PGRST202", "PGRST205"].includes(error?.code ?? "")) {
    return new ApiError(503, "AGENT_DOCUMENT_GRANT_SETUP_REQUIRED", "AI 문서 읽기 권한 구조를 준비한 뒤 다시 시도해 주세요.");
  }
  return new ApiError(403, "AGENT_DOCUMENT_GRANT_DENIED", "선택한 문서 또는 AI 연결에 읽기 권한을 설정할 수 없습니다.");
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const documentId = id.parse(new URL(request.url).searchParams.get("documentId"));
    await ownedDraft(actor.ownerId, documentId);
    const service = createServiceSupabase();
    const organization = await getDefaultOrganization();
    let keysQuery = service.from("os_agent_keys")
      .select("id,name,owner_user_id,scopes,active,expires_at")
      .eq("organization_id", organization.id).eq("active", true).contains("scopes", ["knowledge.read"]);
    if (actor.role !== "admin") keysQuery = keysQuery.eq("owner_user_id", actor.ownerId);
    const [keys, grants] = await Promise.all([
      keysQuery.order("name"),
      service.from("os_agent_document_read_grants")
        .select("agent_key_id,expires_at,created_at,revoked_at")
        .eq("document_id", documentId).eq("granted_by", actor.ownerId).is("revoked_at", null),
    ]);
    if (keys.error || grants.error) throw grantError(keys.error ?? grants.error);
    const now = Date.now();
    return NextResponse.json({
      keys: (keys.data ?? []).filter(key => !key.expires_at || Date.parse(key.expires_at) > now)
        .map(key => ({ id: key.id, name: key.name, ownerUserId: key.owner_user_id })),
      grants: (grants.data ?? []).filter(grant => !grant.expires_at || Date.parse(grant.expires_at) > now),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_DOCUMENT_ID", "문서 ID를 확인해 주세요."));
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = grantSchema.parse(await parseJson(request, 4_000));
    await ownedDraft(actor.ownerId, input.documentId);
    const expiresAt = input.duration === "ongoing" ? null
      : new Date(Date.now() + (input.duration === "7d" ? 7 : 1) * 86_400_000).toISOString();
    const { data, error } = await actor.supabase.rpc("os_grant_agent_document_read", {
      p_document: input.documentId, p_agent_key: input.agentKeyId,
      p_reason: input.reason, p_expires_at: expiresAt,
    });
    if (error || !data) throw grantError(error);
    return NextResponse.json({ granted: true, expiresAt }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_AGENT_DOCUMENT_GRANT", "문서·연결·기간·사유를 확인해 주세요."));
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = revokeSchema.parse(await parseJson(request, 4_000));
    await ownedDraft(actor.ownerId, input.documentId);
    const { error } = await actor.supabase.rpc("os_revoke_agent_document_read", {
      p_document: input.documentId, p_agent_key: input.agentKeyId,
    });
    if (error) throw grantError(error);
    return NextResponse.json({ revoked: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_AGENT_DOCUMENT_GRANT", "문서와 연결을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
