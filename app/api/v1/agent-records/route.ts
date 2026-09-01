import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { RECORD_TYPES, type RecordType } from "@/lib/record-types";
import { recordCreateSchema, recordUpdateSchema } from "@/lib/record-validation";
import { authenticateRequest, requireAgentScope, type RequestActor } from "@/lib/server/auth";
import { assertOrganization } from "@/lib/server/organization";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const organizationId = z.string().uuid();
const protectedTypes = new Set<RecordType>(["access_rule"]);
const columnMap = {
  recordType: "record_type", assigneeId: "assignee_id", parentId: "parent_id", dueDate: "due_date",
  startsAt: "starts_at", endsAt: "ends_at", metricTarget: "metric_target", metricCurrent: "metric_current",
  metricUnit: "metric_unit", sourceUrl: "source_url",
} as const;

function databaseFields(input: Record<string, unknown>) {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (["id", "expectedVersion", "organizationId", "reason", "confirm"].includes(key)) continue;
    output[columnMap[key as keyof typeof columnMap] ?? key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] = value;
  }
  return output;
}

function enforceHumanGates(recordType: RecordType, status?: string) {
  if (protectedTypes.has(recordType)) throw new ApiError(403, "HUMAN_PERMISSION_GATE", "권한 정책 변경은 OS 관리자가 직접 승인해야 합니다.");
  if (recordType === "content_publish" && status && ["scheduled", "published"].includes(status)) {
    throw new ApiError(403, "HUMAN_PUBLISH_GATE", "외부 예약·발행은 OS에서 사람이 직접 승인해야 합니다.");
  }
}

async function rateLimit(actor: RequestActor, action: "record.create" | "record.update" | "record.delete") {
  if (actor.type !== "agent") return;
  const service = createServiceSupabase();
  const minuteLimit = action === "record.delete" ? 5 : 20;
  const dayLimit = action === "record.delete" ? 30 : 200;
  const now = Date.now();
  const [minute, day] = await Promise.all([
    service.from("os_agent_audit_logs").select("id", { count: "exact", head: true }).eq("agent_key_id", actor.id).eq("action", action).gte("created_at", new Date(now - 60_000).toISOString()),
    service.from("os_agent_audit_logs").select("id", { count: "exact", head: true }).eq("agent_key_id", actor.id).eq("action", action).gte("created_at", new Date(now - 86_400_000).toISOString()),
  ]);
  if ((minute.count ?? 0) >= minuteLimit || (day.count ?? 0) >= dayLimit) throw new ApiError(429, "AGENT_RATE_LIMITED", "AI 운영 기록 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.");
}

async function audit(actor: RequestActor, organization: string, action: string, record: { id: string; title: string }, changedFields: string[], reason: string) {
  if (actor.type !== "agent") return;
  const { error } = await createServiceSupabase().from("os_agent_audit_logs").insert({
    organization_id: organization, agent_key_id: actor.id, owner_user_id: actor.ownerId, action,
    record_id: record.id, title_snapshot: record.title, changed_fields: changedFields, reason,
  });
  if (error) throw new ApiError(400, "AGENT_AUDIT_FAILED", "AI 변경 감사 로그를 저장하지 못했습니다.", error.message);
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request, { allowAgent: true, requiredAgentScope: "records.read" });
    const url = new URL(request.url);
    const organization = organizationId.parse(url.searchParams.get("organizationId"));
    await assertOrganization(actor, organization);
    const service = createServiceSupabase();
    const id = url.searchParams.get("recordId");
    if (id) {
      const recordId = z.string().uuid().parse(id);
      const { data, error } = await service.from("os_records").select("*").eq("id", recordId).maybeSingle();
      if (error || !data) throw new ApiError(404, "RECORD_NOT_FOUND", "운영 기록을 찾지 못했습니다.");
      return NextResponse.json({ record: data });
    }
    const type = url.searchParams.get("type") as RecordType | null;
    if (type && !RECORD_TYPES.includes(type)) throw new ApiError(400, "INVALID_RECORD_TYPE", "지원하지 않는 운영 기록 유형입니다.");
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100), 1), 200);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
    let query = service.from("os_records").select("*", { count: "exact" }).is("archived_at", null).order("updated_at", { ascending: false }).range(offset, offset + limit - 1);
    if (type) query = query.eq("record_type", type);
    const { data, count, error } = await query;
    if (error) throw new ApiError(400, "RECORD_LIST_FAILED", "운영 기록을 불러오지 못했습니다.", error.message);
    return NextResponse.json({ records: data ?? [], total: count ?? 0 });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request, { allowAgent: true, requiredAgentScope: "records.write" });
    requireAgentScope(actor, "records.write");
    const raw = await parseJson(request);
    const organization = organizationId.parse(raw.organizationId);
    await assertOrganization(actor, organization);
    const input = recordCreateSchema.parse(raw);
    enforceHumanGates(input.recordType, input.status);
    await rateLimit(actor, "record.create");
    const { data, error } = await createServiceSupabase().from("os_records").insert({
      ...databaseFields(input), owner_id: actor.ownerId, created_by: actor.ownerId, updated_by: actor.ownerId,
    }).select("*").single();
    if (error || !data) throw new ApiError(400, "RECORD_CREATE_FAILED", "운영 기록을 저장하지 못했습니다.", error?.message);
    await audit(actor, organization, "record.create", data, Object.keys(databaseFields(input)), String(raw.reason ?? "MCP 운영 기록 생성"));
    return NextResponse.json({ record: data }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_RECORD", "운영 기록 입력을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await authenticateRequest(request, { allowAgent: true, requiredAgentScope: "records.write" });
    requireAgentScope(actor, "records.write");
    const raw = await parseJson(request);
    const organization = organizationId.parse(raw.organizationId);
    await assertOrganization(actor, organization);
    const input = recordUpdateSchema.parse(raw);
    const service = createServiceSupabase();
    const { data: current } = await service.from("os_records").select("record_type,status").eq("id", input.id).is("archived_at", null).maybeSingle();
    if (!current) throw new ApiError(404, "RECORD_NOT_FOUND", "운영 기록을 찾지 못했습니다.");
    const recordType = (input.recordType ?? current.record_type) as RecordType;
    enforceHumanGates(recordType, input.status);
    await rateLimit(actor, "record.update");
    const payload = { ...databaseFields(input), updated_by: actor.ownerId };
    const { data, error } = await service.from("os_records").update(payload).eq("id", input.id).eq("version", input.expectedVersion).is("archived_at", null).select("*").maybeSingle();
    if (error) throw new ApiError(400, "RECORD_UPDATE_FAILED", "운영 기록을 수정하지 못했습니다.", error.message);
    if (!data) throw new ApiError(409, "RECORD_VERSION_CONFLICT", "다른 작업이 먼저 수정했습니다. 최신 버전으로 다시 시도해 주세요.");
    await audit(actor, organization, "record.update", data, Object.keys(databaseFields(input)), String(raw.reason ?? "MCP 운영 기록 수정"));
    return NextResponse.json({ record: data });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_RECORD", "운영 기록 수정을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await authenticateRequest(request, { allowAgent: true, requiredAgentScope: "records.write" });
    requireAgentScope(actor, "records.write");
    const url = new URL(request.url);
    const organization = organizationId.parse(url.searchParams.get("organizationId"));
    const id = z.string().uuid().parse(url.searchParams.get("recordId"));
    const confirm = z.literal("true").parse(url.searchParams.get("confirm"));
    void confirm;
    await assertOrganization(actor, organization);
    const service = createServiceSupabase();
    const { data: current } = await service.from("os_records").select("id,title,record_type,version").eq("id", id).is("archived_at", null).maybeSingle();
    if (!current) throw new ApiError(404, "RECORD_NOT_FOUND", "운영 기록을 찾지 못했습니다.");
    enforceHumanGates(current.record_type as RecordType);
    await rateLimit(actor, "record.delete");
    const { data, error } = await service.from("os_records").update({ archived_at: new Date().toISOString(), updated_by: actor.ownerId }).eq("id", id).eq("version", current.version).select("id,title").maybeSingle();
    if (error || !data) throw new ApiError(409, "RECORD_ARCHIVE_FAILED", "운영 기록을 휴지통으로 옮기지 못했습니다.", error?.message);
    await audit(actor, organization, "record.delete", data, ["archived_at"], url.searchParams.get("reason") ?? "MCP 휴지통 이동");
    return NextResponse.json({ deleted: true, permanent: false, recordId: id });
  } catch (error) { return apiErrorResponse(error); }
}
