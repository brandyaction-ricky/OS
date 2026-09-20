import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { assertOrganization } from "@/lib/server/organization";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const organizationId = z.string().uuid();
const skillId = z.string().uuid();
const scopeSchema = z.enum(["all", "company", "personal"]);

function canReadSkill(actor: Awaited<ReturnType<typeof authenticateRequest>>, skill: { owner_id: string | null; status: string; metadata: Record<string, unknown> | null }) {
  const companyReady = skill.metadata?.scope === "company" && skill.status === "ready";
  return companyReady || (actor.type === "agent" && skill.owner_id === actor.ownerId);
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request, { allowAgent: true, requiredAgentScope: "records.read" });
    const url = new URL(request.url);
    const organization = organizationId.parse(url.searchParams.get("organizationId"));
    await assertOrganization(actor, organization);
    const service = createServiceSupabase();
    const requestedId = url.searchParams.get("skillId");
    if (requestedId) {
      const id = skillId.parse(requestedId);
      const { data, error } = await service.from("os_records").select("*").eq("id", id).eq("record_type", "skill").is("archived_at", null).maybeSingle();
      if (error || !data) throw new ApiError(404, "SKILL_NOT_FOUND", "Skill을 찾지 못했습니다.");
      if (!canReadSkill(actor, data)) throw new ApiError(403, "SKILL_FORBIDDEN", "이 Skill을 읽을 권한이 없습니다.");
      return NextResponse.json({ skill: data });
    }

    const scope = scopeSchema.parse(url.searchParams.get("scope") ?? "all");
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50), 1), 100);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
    const q = (url.searchParams.get("q") ?? "").replace(/[^\p{L}\p{N} _-]/gu, " ").trim().slice(0, 200);
    let query = service.from("os_records").select("*", { count: "exact" }).eq("record_type", "skill").is("archived_at", null);
    if (actor.type !== "agent") throw new ApiError(403, "AGENT_REQUIRED", "AI 접근 키로 요청해 주세요.");
    if (scope === "company") query = query.eq("metadata->>scope", "company").eq("status", "ready");
    else if (scope === "personal") query = query.eq("owner_id", actor.ownerId);
    else query = query.or(`and(metadata->>scope.eq.company,status.eq.ready),owner_id.eq.${actor.ownerId}`);
    if (q) query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);
    const { data, count, error } = await query.order("updated_at", { ascending: false }).range(offset, offset + limit - 1);
    if (error) throw new ApiError(400, "SKILL_LIST_FAILED", "Skill 목록을 불러오지 못했습니다.", error.message);
    return NextResponse.json({ skills: data ?? [], total: count ?? 0, scope });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_SKILL_QUERY", "Skill 조회 조건을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
