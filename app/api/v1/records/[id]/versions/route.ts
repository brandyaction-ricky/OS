import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const restoreSchema = z.object({
  version: z.number().int().positive(),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().max(500).optional().default("운영 기록 이전 버전 복원"),
});

const restorable = [
  "title", "description", "status", "priority", "stage", "brand", "team", "assignee_id", "parent_id",
  "due_date", "starts_at", "ends_at", "progress", "metric_target", "metric_current", "metric_unit", "amount",
  "currency", "source_url", "tags", "metadata", "archived_at",
] as const;

async function authorize(request: Request, id: string) {
  const actor = await authenticateRequest(request);
  const service = createServiceSupabase();
  const { data, error } = await service.from("os_records").select("*").eq("id", id).maybeSingle();
  if (error || !data) throw new ApiError(404, "RECORD_NOT_FOUND", "운영 기록을 찾지 못했습니다.");
  if (actor.role !== "admin" && ![data.owner_id, data.created_by, data.assignee_id].includes(actor.id)) {
    throw new ApiError(403, "RECORD_RESTORE_FORBIDDEN", "이 운영 기록의 버전을 복원할 권한이 없습니다.");
  }
  return { actor, service, current: data };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = z.string().uuid().parse((await context.params).id);
    const { service } = await authorize(request, id);
    const { data, error } = await service.from("os_record_events")
      .select("id,event_type,changed_fields,note,snapshot,created_at")
      .eq("record_id", id).order("created_at", { ascending: false }).limit(200);
    if (error) throw new ApiError(400, "RECORD_VERSIONS_FAILED", "운영 기록 버전을 불러오지 못했습니다.", error.message);
    const versions = (data ?? []).map((event) => ({
      eventId: event.id, version: Number(event.snapshot?.version ?? 0), eventType: event.event_type,
      title: String(event.snapshot?.title ?? "운영 기록"), changedFields: event.changed_fields ?? [], note: event.note ?? "", createdAt: event.created_at,
    })).filter((event) => event.version > 0);
    return NextResponse.json({ versions });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = z.string().uuid().parse((await context.params).id);
    const input = restoreSchema.parse(await parseJson(request, 16_000));
    const { actor, service, current } = await authorize(request, id);
    if (current.version !== input.expectedVersion) throw new ApiError(409, "RECORD_VERSION_CONFLICT", "다른 작업이 먼저 수정했습니다. 최신 버전을 다시 불러와 주세요.");
    const { data: events, error: versionError } = await service.from("os_record_events").select("snapshot").eq("record_id", id).order("created_at", { ascending: false }).limit(200);
    if (versionError) throw new ApiError(400, "RECORD_VERSION_READ_FAILED", "복원할 버전을 확인하지 못했습니다.", versionError.message);
    const snapshot = (events ?? []).map((event) => event.snapshot).find((value) => Number(value?.version) === input.version);
    if (!snapshot) throw new ApiError(404, "RECORD_VERSION_NOT_FOUND", "복원할 운영 기록 버전을 찾지 못했습니다.");
    const payload = Object.fromEntries(restorable.map((field) => [field, snapshot[field]]));
    payload.metadata = { ...(snapshot.metadata ?? {}), restoredFromVersion: input.version, restoreReason: input.reason };
    payload.updated_by = actor.id;
    const { data, error } = await service.from("os_records").update(payload).eq("id", id).eq("version", input.expectedVersion).select("*").maybeSingle();
    if (error) throw new ApiError(400, "RECORD_RESTORE_FAILED", "운영 기록을 복원하지 못했습니다.", error.message);
    if (!data) throw new ApiError(409, "RECORD_VERSION_CONFLICT", "다른 작업이 먼저 수정했습니다. 최신 버전을 다시 불러와 주세요.");
    const { data: latestEvent } = await service.from("os_record_events").select("id").eq("record_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (latestEvent) await service.from("os_record_events").update({ event_type: "restored", note: input.reason }).eq("id", latestEvent.id);
    return NextResponse.json({ record: data });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_RECORD_VERSION", "복원할 버전을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
