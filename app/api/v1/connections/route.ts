import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { connectionConfiguration, probeConnection, readConnectionChecks } from "@/lib/server/connection-checks";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const service = z.enum(["database", "auth", "embeddings", "telegram", "contentAi", "youtube", "advertising", "orders"]);
async function admin(request: Request) {
  const actor = await authenticateRequest(request);
  if (actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "작동 상태 상세와 연결 테스트는 관리자만 사용할 수 있습니다.");
  return actor;
}
export async function GET(request: Request) {
  try { await admin(request); return NextResponse.json({ checks: await readConnectionChecks(), checkedAt: new Date().toISOString() }, { headers: { "cache-control": "no-store" } }); }
  catch (error) { return apiErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await admin(request);
    const input = z.object({ service }).safeParse(await parseJson(request));
    if (!input.success) throw new ApiError(400, "INVALID_SERVICE", "연결 대상을 확인해 주세요.");
    const id = input.data.service;
    if (!connectionConfiguration()[id]) throw new ApiError(409, "CONNECTION_NOT_CONFIGURED", "연결 설정 또는 수집 기능이 준비되지 않았습니다.");
    const db = createServiceSupabase();
    const available = await db.from("os_connection_checks").select("id").limit(1);
    if (available.error) throw new ApiError(503, "CONNECTION_HISTORY_UNAVAILABLE", "연결 확인 이력 저장소가 준비되지 않았습니다. 관리자에게 적용 상태를 확인해 주세요.");
    const recent = await db.from("os_connection_checks").select("id", { count: "exact", head: true }).eq("service", id).eq("source", "probe").gte("checked_at", new Date(Date.now() - 60_000).toISOString());
    if (recent.error) throw new ApiError(503, "CONNECTION_HISTORY_UNAVAILABLE", "테스트 이력을 확인하지 못했습니다.");
    if ((recent.count ?? 0) >= 3) throw new ApiError(429, "CONNECTION_TEST_LIMIT", "잠시 후 다시 확인해 주세요. 연결별 1분에 3회까지 테스트합니다.");
    let ok = false;
    try { await probeConnection(id, actor); ok = true; } catch { /* Persist only outcome, never upstream bodies or secrets. */ }
    const saved = await db.from("os_connection_checks").insert({ service: id, ok });
    if (saved.error) throw new ApiError(503, "CONNECTION_HISTORY_SAVE_FAILED", "테스트 결과를 저장하지 못했습니다. 연결 상태를 다시 확인해 주세요.");
    return NextResponse.json({ ok, checks: await readConnectionChecks() }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
export async function PATCH(request: Request) {
  try {
    await admin(request);
    const parsed = z.object({ service, primaryOwner: z.string().uuid().nullable(), backupOwner: z.string().uuid().nullable(), expectedVersion: z.number().int().min(0) }).safeParse(await parseJson(request));
    if (!parsed.success) throw new ApiError(400, "INVALID_OWNERS", "담당자를 확인해 주세요.");
    const input = parsed.data;
    if (input.primaryOwner && input.primaryOwner === input.backupOwner) throw new ApiError(400, "DUPLICATE_OWNERS", "정 담당과 부 담당은 다르게 지정해 주세요.");
    const db = createServiceSupabase();
    const ids = [input.primaryOwner, input.backupOwner].filter((id): id is string => Boolean(id));
    if (ids.length) {
      const members = await db.from("os_profiles").select("id").in("id", ids).eq("is_active", true);
      if (members.error || members.data?.length !== ids.length) throw new ApiError(400, "INACTIVE_OWNER", "활성 구성원을 선택해 주세요.");
    }
    const values = { service: input.service, primary_owner: input.primaryOwner, backup_owner: input.backupOwner, version: input.expectedVersion + 1 };
    const result = input.expectedVersion === 0 ? await db.from("os_connection_owners").insert(values).select("service")
      : await db.from("os_connection_owners").update(values).eq("service", input.service).eq("version", input.expectedVersion).select("service");
    if (result.error?.code === "23505" || (!result.error && !result.data?.length)) throw new ApiError(409, "OWNER_CONFLICT", "다른 사용자가 담당자를 변경했습니다. 새로고침 후 다시 저장해 주세요.");
    if (result.error) throw new ApiError(503, "OWNER_SAVE_FAILED", "담당자를 저장하지 못했습니다. 저장소 적용 상태를 확인해 주세요.");
    return NextResponse.json({ ok: true });
  } catch (error) { return apiErrorResponse(error); }
}
