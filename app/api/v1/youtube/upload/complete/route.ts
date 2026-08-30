import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { getYoutubeAccessToken, youtubeConnectionStatus } from "@/lib/server/youtube-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({ kitId: z.string().uuid(), videoId: z.string().regex(/^[A-Za-z0-9_-]{6,20}$/), privacyStatus: z.enum(["private", "unlisted"]), finalApproval: z.literal(true) });

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    if (actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 업로드 결과를 확정할 수 있습니다.");
    const input = inputSchema.parse(await parseJson(request, 20_000));
    const accessToken = await getYoutubeAccessToken(actor.id);
    const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=id,snippet,status&id=${encodeURIComponent(input.videoId)}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    const body = await response.json().catch(() => ({})) as { items?: Array<{ id: string; snippet?: { title?: string; channelId?: string }; status?: { privacyStatus?: string } }>; error?: { message?: string } };
    if (!response.ok) throw new ApiError(502, "YOUTUBE_UPLOAD_VERIFY_FAILED", "업로드된 영상을 확인하지 못했습니다.", body.error?.message);
    const video = body.items?.[0]; const connection = await youtubeConnectionStatus(actor.id);
    if (!video || video.snippet?.channelId !== connection.channelId) throw new ApiError(409, "YOUTUBE_UPLOAD_OWNERSHIP_FAILED", "연결된 채널의 업로드 결과가 아닙니다.");
    const { data: kit } = await actor.supabase.from("os_records").select("*").eq("id", input.kitId).eq("record_type", "content_package").maybeSingle();
    if (!kit || kit.metadata?.packageKind !== "youtube_kit") throw new ApiError(404, "YOUTUBE_KIT_NOT_FOUND", "유튜브 발행 키트를 찾지 못했습니다.");
    const uploadedAt = new Date().toISOString(); const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
    const { error: updateError } = await actor.supabase.from("os_records").update({
      metadata: { ...kit.metadata, youtubeUpload: { videoId: video.id, videoUrl, privacyStatus: video.status?.privacyStatus || input.privacyStatus, channelId: connection.channelId, channelTitle: connection.channelTitle, uploadedAt, approvedBy: actor.id } },
      updated_by: actor.id,
    }).eq("id", kit.id).eq("version", kit.version);
    if (updateError) throw new ApiError(409, "YOUTUBE_KIT_UPDATE_FAILED", "영상은 업로드됐지만 키트 기록을 갱신하지 못했습니다. 목록을 새로 불러와 주세요.", updateError.message);
    const { error: recordError } = await actor.supabase.from("os_records").insert({
      record_type: "content_publish", title: video.snippet?.title || kit.title, description: "YouTube OAuth 업로드 완료",
      status: "published", priority: "normal", stage: "YouTube 업로드", brand: kit.brand || "", team: kit.team || actor.team,
      owner_id: actor.id, parent_id: kit.parent_id, source_url: videoUrl, tags: ["유튜브", "업로드완료"], created_by: actor.id, updated_by: actor.id,
      metadata: { platform: "youtube", youtubeVideoId: video.id, privacyStatus: video.status?.privacyStatus || input.privacyStatus, channelId: connection.channelId, finalApproved: true, approvedBy: actor.id, uploadedAt, kitId: kit.id },
    });
    if (recordError) throw new ApiError(500, "YOUTUBE_PUBLISH_RECORD_FAILED", "영상은 업로드됐지만 발행 기록을 저장하지 못했습니다.", recordError.message);
    return NextResponse.json({ uploaded: true, videoId: video.id, videoUrl, privacyStatus: video.status?.privacyStatus || input.privacyStatus });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_YOUTUBE_UPLOAD_RESULT", "업로드 결과를 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
