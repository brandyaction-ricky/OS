import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { DEVELOPMENT_REQUEST_STATUSES, DevelopmentRequestPolicyError, developmentRequestCreateSchema, developmentRequestMetadata, developmentRequestUpdateFields, developmentRequestUpdateSchema, validateDevelopmentRequestUpdate } from "@/lib/development-requests";
import type { OsRecord } from "@/lib/record-types";
import { authenticateRequest, type RequestActor } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const querySchema = z.object({
  id: z.string().uuid().optional(), projectId: z.string().uuid().optional(),
  q: z.string().trim().max(200).default(""),
  status: z.enum(DEVELOPMENT_REQUEST_STATUSES).optional(),
  scope: z.enum(["all", "mine"]).default("all"),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  summary: z.enum(["0", "1"]).optional(),
});

function respondError(error: unknown) {
  if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_DEVELOPMENT_REQUEST", "요청 내용을 확인해 주세요.", error.flatten()));
  if (error instanceof DevelopmentRequestPolicyError) return apiErrorResponse(new ApiError(error.status, error.code, error.message));
  return apiErrorResponse(error);
}

async function assertProject(actor: RequestActor, id: string | null | undefined) {
  if (!id) return;
  const { data, error } = await actor.supabase.from("os_records").select("id").eq("id", id).eq("record_type", "project").is("archived_at", null).maybeSingle();
  if (error) throw new ApiError(500, "REQUEST_PROJECT_FAILED", "연결할 프로젝트를 확인하지 못했습니다.");
  if (!data) throw new ApiError(404, "REQUEST_PROJECT_NOT_FOUND", "연결할 프로젝트가 없거나 접근할 수 없습니다.");
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const query = input.q.replace(/[%_,()]/g, " ").trim();
    const filtered = (head = false) => {
      let result = actor.supabase.from("os_records").select(head ? "id" : "*", { count: "exact", head }).eq("record_type", "ai_job").eq("metadata->>kind", "development_request").is("archived_at", null);
      if (input.id) result = result.eq("id", input.id);
      if (input.projectId) result = result.eq("parent_id", input.projectId);
      if (input.scope === "mine") result = result.eq("created_by", actor.id);
      if (query) result = result.or(`title.ilike.%${query}%,description.ilike.%${query}%`);
      return result;
    };
    let rowsQuery = filtered().order("created_at", { ascending: false }).order("id", { ascending: false }).range(input.offset, input.offset + input.limit - 1);
    if (input.status) rowsQuery = rowsQuery.eq("status", input.status);
    else if (input.summary === "1") rowsQuery = rowsQuery.neq("status", "done");
    const [rows, ...summaries] = await Promise.all([rowsQuery, ...DEVELOPMENT_REQUEST_STATUSES.map((status) => filtered(true).eq("status", status))]);
    if (rows.error || summaries.some((item) => item.error)) throw new ApiError(500, "REQUEST_LIST_FAILED", "수정 요청을 불러오지 못했습니다.");
    const counts = Object.fromEntries(DEVELOPMENT_REQUEST_STATUSES.map((status, index) => [status, summaries[index].count ?? 0]));
    return NextResponse.json({ requests: rows.data ?? [], total: rows.count ?? 0, counts, canManage: actor.role === "admin" }, { headers });
  } catch (error) { return respondError(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = developmentRequestCreateSchema.parse(await parseJson(request, 64_000));
    await assertProject(actor, input.parentId);
    const { data, error } = await actor.supabase.from("os_records").insert({
      record_type: "ai_job", title: input.title, description: input.description, priority: input.priority,
      status: "backlog", parent_id: input.parentId, team: actor.team, metadata: developmentRequestMetadata(input),
      owner_id: actor.id, created_by: actor.id, updated_by: actor.id,
    }).select("*").single();
    if (error || !data) throw new ApiError(500, "REQUEST_CREATE_FAILED", "수정 요청을 저장하지 못했습니다.");
    return NextResponse.json({ record: data }, { status: 201, headers });
  } catch (error) { return respondError(error); }
}

export async function PATCH(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = developmentRequestUpdateSchema.parse(await parseJson(request, 64_000));
    const { data: current, error: readError } = await actor.supabase.from("os_records").select("*").eq("id", input.id).eq("record_type", "ai_job").eq("metadata->>kind", "development_request").is("archived_at", null).maybeSingle();
    if (readError) throw new ApiError(500, "REQUEST_READ_FAILED", "요청을 확인하지 못했습니다.");
    if (!current) throw new ApiError(404, "REQUEST_NOT_FOUND", "수정 요청을 찾지 못했습니다.");
    if (current.version !== input.expectedVersion) throw new ApiError(409, "RECORD_VERSION_CONFLICT", "다른 사람이 먼저 수정했습니다. 최신 요청을 다시 열어 주세요.");
    validateDevelopmentRequestUpdate(current as OsRecord, input, actor);
    await assertProject(actor, input.parentId);
    const { data, error } = await actor.supabase.from("os_records").update({ ...developmentRequestUpdateFields(current as OsRecord, input), updated_by: actor.id }).eq("id", input.id).eq("version", input.expectedVersion).is("archived_at", null).select("*").maybeSingle();
    if (error) throw new ApiError(500, "REQUEST_UPDATE_FAILED", "수정 요청을 변경하지 못했습니다.");
    if (!data) throw new ApiError(409, "RECORD_VERSION_CONFLICT", "다른 사람이 먼저 수정했습니다. 최신 요청을 다시 열어 주세요.");
    return NextResponse.json({ record: data }, { headers });
  } catch (error) { return respondError(error); }
}
