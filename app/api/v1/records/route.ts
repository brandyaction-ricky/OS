import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { RECORD_TYPES, type RecordType } from "@/lib/record-types";
import { recordCreateSchema, recordUpdateSchema } from "@/lib/record-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMN_MAP = {
  recordType: "record_type", assigneeId: "assignee_id", parentId: "parent_id",
  dueDate: "due_date", startsAt: "starts_at", endsAt: "ends_at",
  metricTarget: "metric_target", metricCurrent: "metric_current",
  metricUnit: "metric_unit", sourceUrl: "source_url",
} as const;

function toDatabase(input: Record<string, unknown>) {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "id" || key === "expectedVersion") continue;
    output[COLUMN_MAP[key as keyof typeof COLUMN_MAP] ?? key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] = value;
  }
  return output;
}

function safeSearch(value: string) {
  return value.replace(/[%_,()]/g, " ").trim().slice(0, 200);
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100), 1), 200);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
    const recordType = url.searchParams.get("type") as RecordType | null;
    if (recordType && !RECORD_TYPES.includes(recordType)) throw new ApiError(400, "INVALID_RECORD_TYPE", "지원하지 않는 운영 기록 유형입니다.");

    let builder = actor.supabase
      .from("os_records")
      .select("*", { count: "exact" })
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (recordType) builder = builder.eq("record_type", recordType);
    const status = url.searchParams.get("status");
    const brand = url.searchParams.get("brand");
    const team = url.searchParams.get("team");
    const assignee = url.searchParams.get("assignee");
    const query = safeSearch(url.searchParams.get("q") ?? "");
    if (status) builder = builder.eq("status", status);
    if (brand) builder = builder.eq("brand", brand);
    if (team) builder = builder.eq("team", team);
    if (assignee === "me") builder = builder.eq("assignee_id", actor.id);
    else if (assignee) builder = builder.eq("assignee_id", assignee);
    if (query) builder = builder.or(`title.ilike.%${query}%,description.ilike.%${query}%`);
    const { data, count, error } = await builder;
    if (error) throw new ApiError(400, "RECORD_LIST_FAILED", "운영 기록을 불러오지 못했습니다.", error.message);
    return NextResponse.json({ records: data ?? [], total: count ?? 0 });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = recordCreateSchema.parse(await parseJson(request));
    if (input.recordType === "leave_balance" && actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 연차를 부여할 수 있습니다.");
    const payload = {
      ...toDatabase(input),
      owner_id: actor.id,
      created_by: actor.id,
      updated_by: actor.id,
      team: input.team || actor.team,
    };
    const { data, error } = await actor.supabase.from("os_records").insert(payload).select("*").single();
    if (error || !data) throw new ApiError(400, "RECORD_CREATE_FAILED", "운영 기록을 저장하지 못했습니다.", error?.message);
    return NextResponse.json({ record: data }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_RECORD", "입력 내용을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = recordUpdateSchema.parse(await parseJson(request));
    const { data: current } = await actor.supabase.from("os_records").select("record_type,status").eq("id", input.id).maybeSingle();
    if (current?.record_type === "leave_balance" && actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 연차 잔여를 변경할 수 있습니다.");
    if (current?.record_type === "leave_request" && (input.status === "approved" || input.status === "rejected")) {
      if (actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 휴가를 승인하거나 반려할 수 있습니다.");
      const { data, error } = await actor.supabase.rpc("os_decide_leave_request", { p_request_id: input.id, p_expected_version: input.expectedVersion, p_status: input.status });
      if (error) throw new ApiError(400, "LEAVE_DECISION_FAILED", "휴가 승인 상태를 변경하지 못했습니다.", error.message);
      if (!data) throw new ApiError(409, "RECORD_VERSION_CONFLICT", "이미 처리되었거나 다른 사람이 먼저 수정했습니다.");
      return NextResponse.json({ record: data });
    }
    const payload = toDatabase(input);
    payload.updated_by = actor.id;
    const { data, error } = await actor.supabase
      .from("os_records")
      .update(payload)
      .eq("id", input.id)
      .eq("version", input.expectedVersion)
      .is("archived_at", null)
      .select("*")
      .maybeSingle();
    if (error) throw new ApiError(400, "RECORD_UPDATE_FAILED", "운영 기록을 수정하지 못했습니다.", error.message);
    if (!data) throw new ApiError(409, "RECORD_VERSION_CONFLICT", "다른 사람이 먼저 수정했습니다. 목록을 새로 불러와 주세요.");
    return NextResponse.json({ record: data });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_RECORD", "수정 내용을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new ApiError(400, "RECORD_ID_REQUIRED", "기록 ID가 필요합니다.");
    const { data: current } = await actor.supabase.from("os_records").select("version").eq("id", id).is("archived_at", null).maybeSingle();
    if (!current) throw new ApiError(404, "RECORD_NOT_FOUND", "운영 기록을 찾지 못했습니다.");
    const { error } = await actor.supabase.from("os_records").update({ archived_at: new Date().toISOString(), updated_by: actor.id }).eq("id", id).eq("version", current.version);
    if (error) throw new ApiError(400, "RECORD_ARCHIVE_FAILED", "운영 기록을 보관하지 못했습니다.", error.message);
    return NextResponse.json({ archived: true });
  } catch (error) { return apiErrorResponse(error); }
}
