import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { developmentNotificationReadSchema, notificationReason, type DevelopmentNotificationItem } from "@/lib/development-notifications";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

function respondError(error: unknown) {
  if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_DEVELOPMENT_NOTIFICATION", "알림 내용을 확인해 주세요.", error.flatten()));
  return apiErrorResponse(error);
}

function text(metadata: Record<string, unknown>, key: string) {
  return typeof metadata[key] === "string" ? metadata[key] : "";
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const service = createServiceSupabase();
    const { data, error } = await service.from("os_records")
      .select("*")
      .eq("record_type", "development_notification")
      .eq("owner_id", actor.ownerId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(0, 99);
    if (error) throw new ApiError(500, "NOTIFICATION_LIST_FAILED", "알림을 불러오지 못했습니다.");

    const notifications = data ?? [];
    const requestIds = [...new Set(notifications.map((item) => String(item.parent_id || "")).filter(Boolean))];
    const requestResult = requestIds.length
      ? await actor.supabase.from("os_records")
        .select("id,title")
        .in("id", requestIds)
        .eq("record_type", "ai_job")
        .eq("metadata->>kind", "development_request")
        .is("archived_at", null)
      : { data: [], error: null };
    if (requestResult.error) throw new ApiError(500, "NOTIFICATION_REQUEST_READ_FAILED", "알림의 개발 요청을 확인하지 못했습니다.");
    const requestTitles = new Map((requestResult.data ?? []).map((item) => [item.id, item.title]));
    const visible = notifications.filter((item) => requestTitles.has(String(item.parent_id || "")));
    const deliveredAt = new Date().toISOString();
    const undelivered = visible.filter((item) => !text(item.metadata ?? {}, "deliveredAt"));
    const deliveryResults = await Promise.all(undelivered.map((item) => service.from("os_records").update({
      status: item.status,
      metadata: { ...(item.metadata ?? {}), deliveredAt },
      updated_by: actor.ownerId,
    }).eq("id", item.id).eq("owner_id", actor.ownerId).eq("version", item.version).select("id").maybeSingle()));
    if (deliveryResults.some((result) => result.error || !result.data)) {
      throw new ApiError(500, "NOTIFICATION_DELIVERY_FAILED", "알림 전달 상태를 저장하지 못했습니다.");
    }

    const items: DevelopmentNotificationItem[] = visible.flatMap((item) => {
      const metadata = (item.metadata ?? {}) as Record<string, unknown>;
      const reason = notificationReason(metadata.reason);
      if (!reason) return [];
      return [{
        id: item.id,
        reason,
        requestId: String(item.parent_id),
        requestTitle: requestTitles.get(String(item.parent_id)) || "개발 요청",
        actorName: text(metadata, "actorName") || "구성원",
        createdAt: item.created_at,
        deliveredAt: text(metadata, "deliveredAt") || deliveredAt,
        readAt: text(metadata, "readAt"),
      }];
    });
    return NextResponse.json({ notifications: items, unread: items.filter((item) => !item.readAt).length, truncated: notifications.length === 100 }, { headers });
  } catch (error) { return respondError(error); }
}

export async function PATCH(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = developmentNotificationReadSchema.parse(await parseJson(request, 8_000));
    const service = createServiceSupabase();
    const { data, error } = await service.from("os_records")
      .select("id,status,metadata,version")
      .eq("record_type", "development_notification")
      .eq("owner_id", actor.ownerId)
      .is("archived_at", null)
      .in("id", input.ids);
    if (error) throw new ApiError(500, "NOTIFICATION_READ_FAILED", "읽음 처리할 알림을 확인하지 못했습니다.");
    if ((data ?? []).length !== input.ids.length) throw new ApiError(404, "NOTIFICATION_NOT_FOUND", "알림이 없거나 읽을 권한이 없습니다.");
    const readAt = new Date().toISOString();
    const results = await Promise.all((data ?? []).map((item) => service.from("os_records").update({
      status: "read",
      metadata: { ...(item.metadata ?? {}), deliveredAt: text(item.metadata ?? {}, "deliveredAt") || readAt, readAt },
      updated_by: actor.ownerId,
    }).eq("id", item.id).eq("owner_id", actor.ownerId).eq("version", item.version).select("id").maybeSingle()));
    if (results.some((result) => result.error || !result.data)) throw new ApiError(409, "NOTIFICATION_READ_CONFLICT", "알림 상태가 바뀌었습니다. 다시 불러와 주세요.");
    return NextResponse.json({ read: results.length, readAt }, { headers });
  } catch (error) { return respondError(error); }
}
