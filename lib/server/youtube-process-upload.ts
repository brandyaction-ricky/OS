import { z } from "zod";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { myinCreditsBlock } from "@/lib/myin-storyboard";
import { utmUrl } from "@/lib/youtube-process/stages";
import type { RequestActor } from "./auth";
import { auditChannelAction } from "./channel-access";
import { authorizeYoutubeConnection, getYoutubeAccessToken, youtubeConnectionStatus } from "./youtube-oauth";
import { youtubeUploadPublication, youtubeUploadRecordId } from "./youtube-upload-result";
import { conflict, getYoutubeProject } from "./youtube-process";
import { MEDIA_BUCKET, readFinals, readStages, writeStage } from "./youtube-process-stages";

// S7 [업로드] (지시서 10-2): the browser sends the last final straight to YouTube's resumable session; the OS checks the
// 최종 검수 OK before opening the session and records the video after.
export const uploadSessionSchema = z.object({ fileName: z.string().trim().min(1).max(255), fileSize: z.number().int().positive().max(137_438_953_472),
  mimeType: z.string().regex(/^video\/[a-z0-9.+-]+$/i), connectionOwnerId: z.string().uuid().optional() }).strict();
export const uploadCompleteSchema = z.object({ videoId: z.string().regex(/^[A-Za-z0-9_-]{6,20}$/), connectionOwnerId: z.string().uuid().optional() }).strict();

/** utm_content: the Data API cannot edit a video with the upload permission alone, so the link carries the project code from the start. */
export const utmCode = (projectId: string) => `yp-${projectId.slice(0, 8)}`;

async function uploadReady(actor: RequestActor, id: string) {
  const project = await getYoutubeProject(actor, id);
  if (project.yp.stage !== "upload" || project.yp.gates.review.state !== "ok") throw new ApiError(409, "REVIEW_CONFIRM_REQUIRED", "최종 검수 컨펌 OK 뒤에 올릴 수 있어요.");
  const stages = await readStages(actor.supabase, project);
  const finals = await readFinals(actor.supabase, project.id, stages.make.data);
  return { project, stages, final: finals.at(-1) ?? null };
}

export async function startYoutubeUpload(actor: RequestActor, id: string, input: z.infer<typeof uploadSessionSchema>) {
  const { project, stages, final } = await uploadReady(actor, id);
  const upload = stages.upload.data;
  if (upload.run?.status === "done") throw new ApiError(409, "UPLOAD_DONE", "이미 유튜브에 올린 영상이에요.");
  if (!final) throw new ApiError(409, "FINAL_REQUIRED", "올릴 최종본이 없어요.");
  if (!upload.desc.trim()) throw new ApiError(409, "DESCRIPTION_REQUIRED", "설명란을 채워 주세요.");
  const ownerId = input.connectionOwnerId ?? actor.id;
  await authorizeYoutubeConnection(actor, ownerId);
  const connection = await youtubeConnectionStatus(ownerId);
  const title = (stages.make.data.aTitle || stages.plan.data.confirmed?.A?.title || project.title).trim().slice(0, 100);
  // ③ 마이인 finals: their photo and music credits close the description (owner decision 2026-10-19).
  let credits = "";
  if (final.source === "myin" && final.runId) {
    const { data } = await createServiceSupabase().from("os_records").select("metadata").eq("id", final.runId).maybeSingle();
    credits = myinCreditsBlock((((data?.metadata as { prepared?: { credits?: string[] } } | undefined)?.prepared?.credits) ?? []).slice(0, 40)).slice(0, 2500);
  }
  const description = upload.desc.replaceAll("[업로드 후 영상 ID]", utmCode(project.id)).replaceAll(utmUrl(upload.utm), utmUrl(upload.utm, utmCode(project.id))).slice(0, 5000 - credits.length) + credits;
  const accessToken = await getYoutubeAccessToken(ownerId);
  const google = await fetch(`https://www.googleapis.com/upload/youtube/v3/videos?${new URLSearchParams({ uploadType: "resumable", part: "snippet,status" })}`, {
    method: "POST", cache: "no-store",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json; charset=UTF-8", "x-upload-content-length": String(input.fileSize), "x-upload-content-type": input.mimeType },
    body: JSON.stringify({ snippet: { title, description, tags: upload.hiddenTags.slice(0, 60), categoryId: "22" }, status: { privacyStatus: upload.privacy, selfDeclaredMadeForKids: false } }),
  });
  const uploadUrl = google.headers.get("location");
  const body = uploadUrl ? null : await google.json().catch(() => ({})) as { error?: { message?: string } };
  if (!google.ok || !uploadUrl) throw new ApiError(502, "YOUTUBE_UPLOAD_SESSION_FAILED", "YouTube 업로드 세션을 만들지 못했습니다.", body?.error?.message);
  await auditChannelAction(actor.id, ownerId, "youtube", "업로드 세션 생성");
  return { uploadUrl, channelId: connection.channelId, finalV: final.v };
}

/** Checks the video is on the connected channel, sets thumbnail A, and records the result on the 업로드 step. */
export async function completeYoutubeUpload(actor: RequestActor, id: string, input: z.infer<typeof uploadCompleteSchema>) {
  const { project, stages, final } = await uploadReady(actor, id);
  const ownerId = input.connectionOwnerId ?? actor.id;
  await authorizeYoutubeConnection(actor, ownerId);
  const accessToken = await getYoutubeAccessToken(ownerId);
  const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=id,snippet,status&id=${encodeURIComponent(input.videoId)}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  const body = await response.json().catch(() => ({})) as { items?: { id: string; snippet?: { title?: string; channelId?: string }; status?: { privacyStatus?: string } }[]; error?: { message?: string } };
  if (!response.ok) throw new ApiError(502, "YOUTUBE_UPLOAD_VERIFY_FAILED", "업로드된 영상을 확인하지 못했습니다.", body.error?.message);
  const video = body.items?.[0];
  const connection = await youtubeConnectionStatus(ownerId);
  if (!video || !connection.channelId || video.snippet?.channelId !== connection.channelId) throw new ApiError(409, "YOUTUBE_UPLOAD_OWNERSHIP_FAILED", "연결된 채널의 업로드 결과가 아닙니다.");
  const service = createServiceSupabase();
  // thumbnails.set works with the upload permission; a channel without custom thumbnails answers 403 and the person sets it in Studio.
  let thumbnail: "ok" | "fail" | "skip" = "skip";
  const thumb = stages.make.data.thumbs.A;
  if (thumb) {
    const { data: file } = await service.storage.from(MEDIA_BUCKET).download(thumb.path);
    const set = file ? await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(video.id)}`, {
      method: "POST", cache: "no-store", headers: { authorization: `Bearer ${accessToken}`, "content-type": thumb.path.endsWith(".png") ? "image/png" : "image/jpeg" }, body: Buffer.from(await file.arrayBuffer()),
    }).catch(() => null) : null;
    thumbnail = set?.ok ? "ok" : "fail";
  }
  const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
  const run = { at: new Date().toISOString(), by: actor.name, status: "done" as const, videoId: video.id, videoUrl, finalV: final?.v, thumbnail };
  await writeStage(actor.supabase, actor.id, actor.team, project, "upload", stages.upload, { ...stages.upload.data, run }).catch(error => {
    throw error instanceof ApiError && error.code === conflict().code ? new ApiError(409, "UPLOAD_RECORD_CONFLICT", "영상은 올라갔지만 기록이 바뀌었어요. 같은 버튼을 다시 누르면 기록만 저장해요.") : error;
  });
  // The performance screens read uploads from content_publish records, as the earlier publishing screen made them.
  const publication = youtubeUploadPublication(video.status?.privacyStatus);
  const { error } = await actor.supabase.from("os_records").insert({
    id: youtubeUploadRecordId(connection.channelId, video.id), record_type: "content_publish", title: video.snippet?.title || project.title, description: "YouTube OAuth 업로드 완료",
    status: publication.status, priority: "normal", stage: publication.stage, team: actor.team, owner_id: actor.id, parent_id: project.id, source_url: videoUrl,
    tags: ["유튜브", "업로드완료"], created_by: actor.id, updated_by: actor.id,
    metadata: { platform: "youtube", youtubeVideoId: video.id, privacyStatus: video.status?.privacyStatus, publicationState: publication.publicationState, channelId: connection.channelId,
      connectionOwnerId: ownerId, finalApproved: true, approvedBy: actor.id, uploadedAt: run.at, projectId: project.id, utmContent: utmCode(project.id) },
  });
  if (error && error.code !== "23505") console.warn(`youtube publish record skipped (${error.code ?? "error"})`);
  await auditChannelAction(actor.id, ownerId, "youtube", "업로드 결과 확인");
  return { videoId: video.id, videoUrl, thumbnail };
}
