import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { getYoutubeAccessToken, youtubeConnectionStatus } from "@/lib/server/youtube-oauth";
import { youtubeUploadPublication, youtubeUploadRecordId } from "@/lib/server/youtube-upload-result";
import type { OsRecord } from "@/lib/record-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({ kitId: z.string().uuid(), videoId: z.string().regex(/^[A-Za-z0-9_-]{6,20}$/), privacyStatus: z.enum(["private", "unlisted"]), finalApproval: z.literal(true) });

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    if (actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 업로드 결과를 확정할 수 있습니다.");
    const input = inputSchema.parse(await parseJson(request, 20_000));
    const { data: kit, error: kitReadError } = await actor.supabase.from("os_records").select("*").eq("id", input.kitId).eq("record_type", "content_package").is("archived_at", null).maybeSingle();
    if (kitReadError) throw new ApiError(500, "YOUTUBE_KIT_READ_FAILED", "유튜브 발행 키트를 불러오지 못했습니다.", kitReadError.message);
    if (!kit || kit.metadata?.packageKind !== "youtube_kit") throw new ApiError(404, "YOUTUBE_KIT_NOT_FOUND", "유튜브 발행 키트를 찾지 못했습니다.");
    const accessToken = await getYoutubeAccessToken(actor.id);
    const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=id,snippet,status&id=${encodeURIComponent(input.videoId)}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    const body = await response.json().catch(() => ({})) as { items?: Array<{ id: string; snippet?: { title?: string; channelId?: string }; status?: { privacyStatus?: string } }>; error?: { message?: string } };
    if (!response.ok) throw new ApiError(502, "YOUTUBE_UPLOAD_VERIFY_FAILED", "업로드된 영상을 확인하지 못했습니다.", body.error?.message);
    const video = body.items?.[0]; const connection = await youtubeConnectionStatus(actor.id);
    if (!video || !connection.channelId || video.snippet?.channelId !== connection.channelId) throw new ApiError(409, "YOUTUBE_UPLOAD_OWNERSHIP_FAILED", "연결된 채널의 업로드 결과가 아닙니다.");
    const privacyStatus = video.status?.privacyStatus;
    if (!["private", "unlisted", "public"].includes(privacyStatus ?? "")) throw new ApiError(502, "YOUTUBE_UPLOAD_PRIVACY_UNKNOWN", "업로드 영상의 실제 공개 상태를 확인하지 못했습니다. 다시 확인해 주세요.");
    const uploadedAt = kit.metadata?.youtubeUpload?.videoId === video.id && typeof kit.metadata.youtubeUpload.uploadedAt === "string" ? kit.metadata.youtubeUpload.uploadedAt : new Date().toISOString();
    const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
    const { data: savedKit, error: updateError } = await actor.supabase.from("os_records").update({
      metadata: { ...kit.metadata, youtubeUpload: { videoId: video.id, videoUrl, privacyStatus, channelId: connection.channelId, channelTitle: connection.channelTitle, uploadedAt, approvedBy: actor.id } },
      updated_by: actor.id,
    }).eq("id", kit.id).eq("version", kit.version).is("archived_at", null).select("id").maybeSingle();
    if (updateError || !savedKit) throw new ApiError(409, "YOUTUBE_KIT_UPDATE_FAILED", "영상은 업로드됐지만 키트 기록을 갱신하지 못했습니다. 목록을 새로 불러와 주세요.", updateError?.message);
    const publication = youtubeUploadPublication(privacyStatus);
    const syncPublication = async (record: Pick<OsRecord, "id" | "version" | "metadata" | "archived_at" | "status" | "stage">) => {
      if (record.archived_at) throw new ApiError(409, "YOUTUBE_PUBLISH_RECORD_ARCHIVED", "이 영상의 업로드 기록은 보관되어 있습니다. 보관함에서 기록을 확인해 주세요.");
      if (record.status === publication.status && record.stage === publication.stage && record.metadata?.privacyStatus === privacyStatus && record.metadata?.publicationState === publication.publicationState) return;
      const { data: saved, error: syncError } = await actor.supabase.from("os_records").update({
        status: publication.status,
        stage: publication.stage,
        metadata: { ...record.metadata, privacyStatus, publicationState: publication.publicationState },
        updated_by: actor.id,
      }).eq("id", record.id).eq("record_type", "content_publish").eq("version", record.version).is("archived_at", null).select("id").maybeSingle();
      if (syncError || !saved) throw new ApiError(409, "YOUTUBE_PUBLISH_RECORD_CONFLICT", "영상은 확인했지만 업로드 기록이 변경됐습니다. 결과 확인을 다시 시도해 주세요.", syncError?.message);
    };
    // Reuse legacy IDs and preserve manual fields while syncing this verified video's visibility.
    const { data: existing, error: existingError } = await actor.supabase.from("os_records").select("id,version,metadata,archived_at,status,stage").eq("record_type", "content_publish").eq("metadata->>youtubeVideoId", video.id).eq("metadata->>channelId", connection.channelId).limit(1).maybeSingle();
    if (existingError) throw new ApiError(500, "YOUTUBE_PUBLISH_READ_FAILED", "기존 업로드 기록을 확인하지 못했습니다. 영상 재업로드 없이 결과 확정을 다시 시도해 주세요.", existingError.message);
    if (existing) {
      await syncPublication(existing);
      return NextResponse.json({ uploaded: true, videoId: video.id, videoUrl, privacyStatus, recordId: existing.id });
    }
    const recordId = youtubeUploadRecordId(connection.channelId, video.id);
    const { error: recordError } = await actor.supabase.from("os_records").insert({
      id: recordId,
      record_type: "content_publish", title: video.snippet?.title || kit.title, description: "YouTube OAuth 업로드 완료",
      status: publication.status, priority: "normal", stage: publication.stage, brand: kit.brand || "", team: kit.team || actor.team,
      owner_id: actor.id, parent_id: kit.parent_id, source_url: videoUrl, tags: ["유튜브", "업로드완료"], created_by: actor.id, updated_by: actor.id,
      metadata: { platform: "youtube", youtubeVideoId: video.id, privacyStatus, publicationState: publication.publicationState, channelId: connection.channelId, finalApproved: true, approvedBy: actor.id, uploadedAt, kitId: kit.id },
    });
    if (recordError) {
      if (recordError.code !== "23505") throw new ApiError(500, "YOUTUBE_PUBLISH_RECORD_FAILED", "영상은 업로드됐지만 발행 기록을 저장하지 못했습니다. 영상 재업로드 없이 결과 확정을 다시 시도해 주세요.", recordError.message);
      const { data: concurrent, error: concurrentError } = await actor.supabase.from("os_records").select("id,version,metadata,archived_at,status,stage").eq("id", recordId).eq("record_type", "content_publish").eq("metadata->>youtubeVideoId", video.id).eq("metadata->>channelId", connection.channelId).maybeSingle();
      if (concurrentError || !concurrent) throw new ApiError(409, "YOUTUBE_PUBLISH_RECORD_CONFLICT", "업로드 기록이 변경됐습니다. 목록을 새로 불러와 주세요.");
      await syncPublication(concurrent);
    }
    return NextResponse.json({ uploaded: true, videoId: video.id, videoUrl, privacyStatus, recordId });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_YOUTUBE_UPLOAD_RESULT", "업로드 결과를 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
