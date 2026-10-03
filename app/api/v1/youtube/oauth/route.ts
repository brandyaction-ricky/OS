import { NextResponse } from "next/server";
import { apiErrorResponse, ApiError, parseJson } from "@/lib/http";
import { z } from "zod";
import { authenticateRequest } from "@/lib/server/auth";
import { buildYoutubeAuthorizationUrl, createYoutubeOAuthState, disconnectYoutube, loadYoutubeConnection, YOUTUBE_OAUTH_COOKIE, youtubeConnectionStatus, youtubeOAuthConfigured } from "@/lib/server/youtube-oauth";
import { assertConnectionAccess, auditChannelAction } from "@/lib/server/channel-access";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const status = youtubeOAuthConfigured() ? await youtubeConnectionStatus(actor.id) : { connected: false, channelId: null, channelTitle: null, connectedAt: null };
    return NextResponse.json({ configured: youtubeOAuthConfigured(), canManage: true, ...status });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    assertConnectionAccess(actor, { owner_id: actor.id }, "reconnect");
    if (!youtubeOAuthConfigured()) throw new ApiError(503, "YOUTUBE_OAUTH_NOT_CONFIGURED", "YouTube OAuth 환경변수를 먼저 등록해 주세요.");
    const state = createYoutubeOAuthState(actor.id);
    const response = NextResponse.json({ authorizationUrl: buildYoutubeAuthorizationUrl(state.nonce) });
    response.cookies.set(YOUTUBE_OAUTH_COOKIE, state.cookie, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/v1/youtube/oauth", maxAge: 600 });
    return response;
  } catch (error) { return apiErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const ownerId = z.string().uuid().parse(new URL(request.url).searchParams.get("ownerId") || actor.id);
    assertConnectionAccess(actor, { owner_id: ownerId }, "disconnect");
    await disconnectYoutube(ownerId);
    await auditChannelAction(actor.id, ownerId, "youtube", "해제");
    return NextResponse.json({ disconnected: true });
  } catch (error) { return apiErrorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = z.object({ teamShared: z.boolean() }).parse(await parseJson(request));
    const connection = await loadYoutubeConnection(actor.id);
    if (!connection) throw new ApiError(404, "CHANNEL_NOT_FOUND", "연결된 채널이 없습니다.");
    assertConnectionAccess(actor, connection, "share");
    const { error } = await createServiceSupabase().from("os_youtube_connections").update({ team_shared: input.teamShared, updated_at: new Date().toISOString() }).eq("owner_id", actor.id);
    if (error) throw new ApiError(500, "CHANNEL_SHARE_FAILED", "팀 공유 상태를 저장하지 못했습니다.");
    await auditChannelAction(actor.id, actor.id, "youtube", input.teamShared ? "팀 공유 켜기" : "팀 공유 끄기");
    return NextResponse.json({ teamShared: input.teamShared });
  } catch (error) { return apiErrorResponse(error); }
}
