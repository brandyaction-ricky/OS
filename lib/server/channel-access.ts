import { ApiError } from "@/lib/http";
import type { RequestActor } from "./auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export type ChannelActor = Pick<RequestActor, "id" | "type" | "role">;
export type ChannelOwnership = { owner_id: string; team_shared?: boolean };
export type ChannelAction = "use" | "share" | "reconnect" | "disconnect";

export function canUseConnection(actor: ChannelActor, connection: ChannelOwnership) {
  return actor.type === "user" && (actor.id === connection.owner_id || connection.team_shared === true);
}
export function canManageConnection(actor: ChannelActor, connection: ChannelOwnership, action: ChannelAction) {
  if (actor.type !== "user") return false;
  if (action === "use") return canUseConnection(actor, connection);
  if (action === "disconnect") return actor.id === connection.owner_id || actor.role === "admin";
  return actor.id === connection.owner_id;
}
export function assertConnectionAccess(actor: ChannelActor, connection: ChannelOwnership, action: ChannelAction = "use") {
  if (!canManageConnection(actor, connection, action)) throw new ApiError(403, "CHANNEL_ACCESS_DENIED", "이 채널의 사용 권한이 없습니다. 연결한 본인 또는 팀 공유 계정으로 확인해 주세요.");
}
export async function assertActiveChannelOwner(ownerId: string) {
  const { data, error } = await createServiceSupabase().from("os_profiles").select("id,is_active").eq("id", ownerId).maybeSingle();
  if (error || !data?.is_active) throw new ApiError(403, "CHANNEL_OWNER_INACTIVE", "연결한 OS 계정이 활성 상태가 아닙니다.");
}
export async function auditChannelAction(actorId: string, ownerId: string, platform: string, action: string) {
  // Existing record events provide the audit trail; tokens and external account IDs are excluded.
  const { error } = await createServiceSupabase().from("os_records").insert({
    record_type: "connection", title: `${platform} 채널 · ${action}`, description: "채널 연결 작업 기록", status: "done",
    owner_id: ownerId, created_by: actorId, updated_by: actorId,
    metadata: { kind: "channel_audit", platform, action }, tags: ["채널연결", "변경기록"],
  });
  if (error) throw new ApiError(500, "CHANNEL_AUDIT_FAILED", "채널 작업의 변경 기록을 저장하지 못했습니다. 연결 상태를 확인해 주세요.");
}
