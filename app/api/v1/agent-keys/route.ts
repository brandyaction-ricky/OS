import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { apiErrorResponse, ApiError, parseJson } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/server/auth";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  team: z.string().trim().max(120).optional().default(""),
  brand: z.string().trim().max(120).nullable().optional().default(null),
  expiresAt: z.string().datetime().nullable().optional().default(null),
});

function requireAdmin(role: string) {
  if (role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 에이전트 키를 관리할 수 있습니다.");
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request); requireAdmin(actor.role);
    const { data, error } = await createServiceSupabase().from("os_agent_keys").select("id,name,key_prefix,team,brand,allowed_statuses,active,last_used_at,expires_at,created_at").order("created_at", { ascending: false });
    if (error) throw new ApiError(400, "AGENT_KEYS_FAILED", "에이전트 키를 불러오지 못했습니다.", error.message);
    return NextResponse.json({ keys: data ?? [] });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request); requireAdmin(actor.role);
    const input = createSchema.parse(await parseJson(request, 16_000));
    const raw = `bos_pat_${randomBytes(24).toString("base64url")}`;
    const { data, error } = await createServiceSupabase().from("os_agent_keys").insert({
      name: input.name,
      key_hash: createHash("sha256").update(raw).digest("hex"),
      key_prefix: raw.slice(0, 16),
      created_by: actor.id,
      team: input.team,
      brand: input.brand,
      scopes: ["knowledge:search"],
      allowed_statuses: ["canonical"],
      expires_at: input.expiresAt,
    }).select("id,name,key_prefix,team,brand,allowed_statuses,active,expires_at,created_at").single();
    if (error) throw new ApiError(400, "AGENT_KEY_CREATE_FAILED", "에이전트 키를 만들지 못했습니다.", error.message);
    return NextResponse.json({ key: data, token: raw, warning: "이 토큰은 다시 표시되지 않습니다." }, { status: 201 });
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
