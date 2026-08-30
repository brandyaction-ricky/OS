import { NextResponse } from "next/server";
import { apiErrorResponse, ApiError } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { buildYoutubeAuthorizationUrl, createYoutubeOAuthState, disconnectYoutube, YOUTUBE_OAUTH_COOKIE, youtubeConnectionStatus, youtubeOAuthConfigured } from "@/lib/server/youtube-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireAdmin(role: string) {
  if (role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 YouTube 채널을 연결하거나 해제할 수 있습니다.");
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const status = youtubeOAuthConfigured() ? await youtubeConnectionStatus(actor.id) : { connected: false, channelId: null, channelTitle: null, connectedAt: null };
    return NextResponse.json({ configured: youtubeOAuthConfigured(), canManage: actor.role === "admin", ...status });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request); requireAdmin(actor.role);
    if (!youtubeOAuthConfigured()) throw new ApiError(503, "YOUTUBE_OAUTH_NOT_CONFIGURED", "YouTube OAuth 환경변수를 먼저 등록해 주세요.");
    const state = createYoutubeOAuthState(actor.id);
    const response = NextResponse.json({ authorizationUrl: buildYoutubeAuthorizationUrl(state.nonce) });
    response.cookies.set(YOUTUBE_OAUTH_COOKIE, state.cookie, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/v1/youtube/oauth", maxAge: 600 });
    return response;
  } catch (error) { return apiErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const actor = await authenticateRequest(request); requireAdmin(actor.role);
    await disconnectYoutube(actor.id);
    return NextResponse.json({ disconnected: true });
  } catch (error) { return apiErrorResponse(error); }
}
