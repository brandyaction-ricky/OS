import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { canUseConnection } from "@/lib/server/channel-access";
import { publicMetaConnection, metaMode, type MetaConnection } from "@/lib/server/meta-oauth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { YOUTUBE_ANALYTICS_SCOPE } from "@/lib/server/youtube-oauth";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request), service = createServiceSupabase();
    const company = new URL(request.url).searchParams.get("scope") === "company";
    const mine = new URL(request.url).searchParams.get("scope") === "mine";
    if (company && actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "회사 전체 연결 목록은 관리자만 확인할 수 있습니다.");
    const visible = <T extends { owner_id: string; team_shared?: boolean }>(row: T) => mine ? row.owner_id === actor.id : (company && actor.role === "admin") || canUseConnection(actor, row);
    let youtubeQuery = service.from("os_youtube_connections").select("owner_id,channel_id,channel_title,team_shared,connected_at,scope");
    let metaQuery = service.from("os_meta_connections").select("*");
    if (mine) { youtubeQuery = youtubeQuery.eq("owner_id",actor.id); metaQuery = metaQuery.eq("owner_id",actor.id); }
    else if (!company) { youtubeQuery = youtubeQuery.or(`owner_id.eq.${actor.id},team_shared.eq.true`); metaQuery = metaQuery.or(`owner_id.eq.${actor.id},team_shared.eq.true`); }
    const [youtube, meta] = await Promise.all([
      youtubeQuery, metaQuery,
    ]);
    if (youtube.error || meta.error) throw new ApiError(503, "CHANNEL_SCHEMA_REQUIRED", "계정별 채널 연결 저장소가 아직 준비되지 않았습니다.");
    const connections = [
      ...(youtube.data ?? []).filter(visible).map(row => ({ platform: "youtube", ownerId: row.owner_id, accountName: row.channel_title, accountType: "YOUTUBE", channelId: row.channel_id, analyticsConnected: String(row.scope ?? "").split(/\s+/).includes(YOUTUBE_ANALYTICS_SCOPE), teamShared: row.team_shared, status: "connected", connectedAt: row.connected_at, expiresAt: null, expiresSoon: false, lastSuccessAt: null, lastErrorCode: null, mock: false })),
      ...((meta.data ?? []) as MetaConnection[]).filter(visible).map(publicMetaConnection),
    ];
    return NextResponse.json({ connections, mode: metaMode() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
