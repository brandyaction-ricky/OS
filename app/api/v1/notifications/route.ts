import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { developmentNotificationReadSchema } from "@/lib/development-notifications";
import { presentNotification } from "@/lib/notifications";
import { authenticateRequest, type RequestActor } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { OsRecord } from "@/lib/record-types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
function respondError(error: unknown) {
  return apiErrorResponse(error instanceof ZodError ? new ApiError(400,"INVALID_NOTIFICATION","알림을 확인해 주세요.") : error);
}
async function visibleSources(actor: RequestActor, rows: OsRecord[]) {
  const ids = (type: string) => [...new Set(rows.filter(row => row.metadata.sourceType === type).map(row => String(row.metadata.sourceId)))];
  const recordIds = ids("record"), documentIds = ids("document");
  const [records, documents] = await Promise.all([
    recordIds.length ? actor.supabase.from("os_records").select("id,title,record_type,metadata").in("id",recordIds).is("archived_at",null) : {data:[],error:null},
    documentIds.length ? actor.supabase.from("os_documents").select("id,title").in("id",documentIds).neq("status","archived") : {data:[],error:null},
  ]);
  if (records.error || documents.error) throw new ApiError(500,"NOTIFICATION_SOURCE_FAILED","알림 원본의 접근 권한을 확인하지 못했습니다.");
  const hrSources = rows.some(row => String(row.metadata.sourceType).startsWith("hr_"))
    ? await (await import("@/lib/server/hr-notifications")).hrNotificationSources(actor,rows) : [];
  return new Map<string, Pick<OsRecord, "id" | "title" | "record_type" | "metadata">>([
    ...hrSources,
    ...(records.data ?? []).map(row => [`record:${row.id}`,row] as const),
    ...(documents.data ?? []).map(row => [`document:${row.id}`,{...row,record_type:"task" as const,metadata:{}}] as const),
  ]);
}
export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const service = createServiceSupabase();
    const schema = await service.rpc("os_notification_schema_version");
    if (schema.error || schema.data !== 1) throw new ApiError(503,"NOTIFICATIONS_NOT_READY","통합 알림 연결을 준비 중입니다. 기존 개발 알림은 계속 확인할 수 있습니다.");
    const {data,error} = await service.from("os_records").select("*").eq("record_type","notification")
      .eq("owner_id",actor.ownerId).is("archived_at",null).order("created_at",{ascending:false}).order("id",{ascending:false}).range(0,99);
    if (error) throw new ApiError(500,"NOTIFICATION_LIST_FAILED","알림을 불러오지 못했습니다.");
    const rows = (data ?? []) as OsRecord[], sources = await visibleSources(actor,rows);
    const notifications = rows.flatMap(row => {
      const source = sources.get(`${row.metadata.sourceType}:${row.metadata.sourceId}`);
      const item = source ? presentNotification(row,source) : null; return item ? [item] : [];
    });
    return NextResponse.json({notifications,unread:notifications.filter(item=>!item.readAt).length,truncated:rows.length===100},{headers});
  } catch(error) { return respondError(error); }
}
export async function PATCH(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = developmentNotificationReadSchema.parse(await parseJson(request,8000));
    const service = createServiceSupabase();
    const {data,error} = await service.from("os_records").select("*").eq("record_type","notification")
      .eq("owner_id",actor.ownerId).is("archived_at",null).in("id",input.ids);
    if(error) throw new ApiError(500,"NOTIFICATION_READ_FAILED","알림 상태를 확인하지 못했습니다.");
    const rows = (data ?? []) as OsRecord[], sources = await visibleSources(actor,rows);
    if(rows.length !== input.ids.length || rows.some(row=>!sources.has(`${row.metadata.sourceType}:${row.metadata.sourceId}`))) throw new ApiError(404,"NOTIFICATION_NOT_FOUND","알림이 없거나 읽을 권한이 없습니다.");
    const readAt = new Date().toISOString();
    const results = await Promise.all(rows.filter(row=>!row.metadata.readAt).map(row=>service.from("os_records").update({status:"read",metadata:{...row.metadata,readAt},updated_by:actor.ownerId})
      .eq("id",row.id).eq("owner_id",actor.ownerId).eq("record_type","notification").eq("version",row.version).select("id").maybeSingle()));
    if(results.some(result=>result.error || !result.data)) throw new ApiError(409,"NOTIFICATION_READ_CONFLICT","알림 상태가 바뀌었습니다. 다시 불러와 주세요.");
    return NextResponse.json({read:rows.length,readAt},{headers});
  } catch(error) { return respondError(error); }
}
