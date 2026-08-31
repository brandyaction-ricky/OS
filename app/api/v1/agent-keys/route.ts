import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { apiErrorResponse, ApiError, parseJson } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/server/auth";
import { getDefaultOrganization } from "@/lib/server/organization";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  team: z.string().trim().max(120).optional().default(""),
  brand: z.string().trim().max(120).nullable().optional().default(null),
  ownerUserId: z.string().uuid().optional(),
  access: z.enum(["read", "write"]).optional().default("read"),
  expiresAt: z.string().datetime().nullable().optional().default(null),
});

function requireAdmin(role: string) {
  if (role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 에이전트 키를 관리할 수 있습니다.");
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request); requireAdmin(actor.role);
    const organization = await getDefaultOrganization();
    const service = createServiceSupabase();
    const { data, error } = await service.from("os_agent_keys").select("id,name,key_prefix,team,brand,scopes,allowed_statuses,owner_user_id,active,last_used_at,expires_at,created_at").eq("organization_id", organization.id).order("created_at", { ascending: false });
    if (error) throw new ApiError(400, "AGENT_KEYS_FAILED", "에이전트 키를 불러오지 못했습니다.", error.message);
    const ownerIds = [...new Set((data ?? []).map((key) => key.owner_user_id).filter(Boolean))];
    const { data: owners } = ownerIds.length
      ? await service.from("os_profiles").select("id,display_name,email,is_active").in("id", ownerIds)
      : { data: [] };
    const ownerMap = new Map((owners ?? []).map((owner) => [owner.id, owner]));
    return NextResponse.json({
      organization,
      keys: (data ?? []).map((key) => ({ ...key, owner: ownerMap.get(key.owner_user_id) ?? null })),
    });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request); requireAdmin(actor.role);
    const input = createSchema.parse(await parseJson(request, 16_000));
    const organization = await getDefaultOrganization();
    const ownerUserId = input.ownerUserId ?? actor.id;
    const service = createServiceSupabase();
    const { data: owner } = await service.from("os_profiles").select("id,is_active").eq("id", ownerUserId).maybeSingle();
    if (!owner?.is_active) throw new ApiError(400, "AGENT_OWNER_INVALID", "활성 구성원만 AI 키의 소유자가 될 수 있습니다.");
    const raw = `bos_pat_${randomBytes(24).toString("base64url")}`;
    const scopes = input.access === "write" ? ["knowledge.read", "knowledge.write"] : ["knowledge.read"];
    const allowedStatuses = input.access === "write"
      ? ["draft", "team", "review", "reviewed", "canonical"]
      : ["canonical"];
    const { data, error } = await service.from("os_agent_keys").insert({
      name: input.name,
      key_hash: createHash("sha256").update(raw).digest("hex"),
      key_prefix: raw.slice(0, 16),
      created_by: actor.id,
      owner_user_id: ownerUserId,
      organization_id: organization.id,
      team: input.team,
      brand: input.brand,
      scopes,
      allowed_statuses: allowedStatuses,
      expires_at: input.expiresAt,
    }).select("id,name,key_prefix,team,brand,scopes,allowed_statuses,owner_user_id,active,expires_at,created_at").single();
    if (error) throw new ApiError(400, "AGENT_KEY_CREATE_FAILED", "에이전트 키를 만들지 못했습니다.", error.message);
    return NextResponse.json({
      key: data,
      organization,
      token: raw,
      warning: "이 토큰은 다시 표시되지 않습니다. 안전한 비밀 저장소에 바로 보관하세요.",
    }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_AGENT_KEY", "키 설정을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await authenticateRequest(request); requireAdmin(actor.role);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new ApiError(400, "AGENT_KEY_ID_REQUIRED", "키 ID가 필요합니다.");
    const { error } = await createServiceSupabase().from("os_agent_keys").update({ active: false, revoked_at: new Date().toISOString() }).eq("id", id);
    if (error) throw new ApiError(400, "AGENT_KEY_REVOKE_FAILED", "키를 폐기하지 못했습니다.", error.message);
    return NextResponse.json({ revoked: true });
  } catch (error) { return apiErrorResponse(error); }
}
