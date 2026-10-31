import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { CTA_MAX_VIDEOS, ctaPlan, ctaUndoable, type CtaChange, type CtaItem, type CtaVideo } from "@/lib/youtube-process/cta";
import type { RequestActor } from "./auth";
import { auditChannelAction } from "./channel-access";
import { authorizeYoutubeConnection, getYoutubeAccessToken, YOUTUBE_MANAGE_SCOPE } from "./youtube-oauth";

// CTA 일괄 관리 (로건 요청 10/30, 대표 결정 2026-10-31): the connected channel's uploads, and their descriptions changed in one go.
// Changing a video needs the 영상 관리 permission (youtube.force-ssl): a connection made before it asks to be made again.
const API = "https://www.googleapis.com/youtube/v3";
type Snippet = { title: string; description?: string; tags?: string[]; categoryId: string; defaultLanguage?: string; defaultAudioLanguage?: string; publishedAt?: string };

async function google<T>(token: string, path: string, params: Record<string, string>, init?: RequestInit) {
  const response = await fetch(`${API}/${path}?${new URLSearchParams(params)}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init?.headers }, cache: "no-store" });
  const body = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new ApiError(502, "YOUTUBE_CTA_FAILED", "유튜브에서 영상 정보를 주고받지 못했어요.", body.error?.message);
  return body;
}

async function managed(actor: RequestActor, ownerId: string) {
  const connection = await authorizeYoutubeConnection(actor, ownerId);
  if (!String(connection.scope ?? "").split(/\s+/).includes(YOUTUBE_MANAGE_SCOPE))
    throw new ApiError(409, "YOUTUBE_MANAGE_SCOPE_MISSING", "유튜브 연결에 「영상 관리」 권한이 없어요. 내 계정 › 채널 연결에서 「다시 연결」을 눌러 허용해 주세요.");
  return getYoutubeAccessToken(ownerId);
}

/** The channel's latest uploads with their descriptions (about 7 quota units for 150). */
export async function channelVideos(actor: RequestActor, ownerId: string, max = 150): Promise<CtaVideo[]> {
  await authorizeYoutubeConnection(actor, ownerId);
  const token = await getYoutubeAccessToken(ownerId);
  const channel = await google<{ items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[] }>(token, "channels", { part: "contentDetails", mine: "true" });
  const playlistId = channel.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!playlistId) return [];
  const ids: string[] = [];
  let pageToken = "";
  do {
    const page = await google<{ items?: { contentDetails?: { videoId?: string } }[]; nextPageToken?: string }>(token, "playlistItems", { part: "contentDetails", playlistId, maxResults: "50", ...(pageToken ? { pageToken } : {}) });
    ids.push(...(page.items ?? []).map(item => item.contentDetails?.videoId ?? "").filter(Boolean));
    pageToken = page.nextPageToken ?? "";
  } while (pageToken && ids.length < max);
  const videos: CtaVideo[] = [];
  for (let at = 0; at < Math.min(ids.length, max); at += 50) {
    const batch = await google<{ items?: { id: string; snippet?: Snippet }[] }>(token, "videos", { part: "snippet", id: ids.slice(at, Math.min(at + 50, max)).join(",") });
    videos.push(...(batch.items ?? []).map(item => ({ id: item.id, title: item.snippet?.title ?? "", description: item.snippet?.description ?? "", publishedAt: item.snippet?.publishedAt ?? "" })));
  }
  return videos;
}

async function setDescription(token: string, videoId: string, change: (current: string) => string | null) {
  const found = await google<{ items?: { id: string; snippet?: Snippet }[] }>(token, "videos", { part: "snippet", id: videoId });
  const snippet = found.items?.[0]?.snippet;
  if (!snippet) throw new ApiError(404, "YOUTUBE_VIDEO_GONE", "영상을 찾지 못했어요.");
  const current = snippet.description ?? "", next = change(current);
  if (next === null) return { title: snippet.title, before: current, after: current, changed: false };
  // videos.update replaces the whole snippet: what is not sent (tags, languages) would be cleared, so it all goes back as it was.
  const { title, tags, categoryId, defaultLanguage, defaultAudioLanguage } = snippet;
  await google(token, "videos", { part: "snippet" }, { method: "PUT", body: JSON.stringify({ id: videoId, snippet: { title, description: next, categoryId,
    ...(tags ? { tags } : {}), ...(defaultLanguage ? { defaultLanguage } : {}), ...(defaultAudioLanguage ? { defaultAudioLanguage } : {}) } }) });
  return { title: snippet.title, before: current, after: next, changed: true };
}

export const ctaApplySchema = z.object({ action: z.literal("apply"), ownerId: z.string().uuid().optional(), find: z.string().min(1).max(500), replace: z.string().max(1000),
  videoIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{6,20}$/)).min(1).max(CTA_MAX_VIDEOS) }).strict();
export const ctaUndoSchema = z.object({ action: z.literal("undo"), ownerId: z.string().uuid().optional(), changeId: z.string().uuid() }).strict();

const changeRecord = (change: CtaChange, actor: RequestActor) => ({ id: change.id, record_type: "content_package", title: `CTA 일괄 바꾸기 · ${change.items.filter(item => item.ok).length}개`,
  description: "", status: "done", priority: "normal", team: actor.team || "콘텐츠", owner_id: actor.id, created_by: actor.id, updated_by: actor.id, tags: ["유튜브", "CTA"],
  metadata: { packageKind: "yp_cta_change", change } });

/** Each video read fresh, changed only if it still has the words; every one recorded (with its text before) for undo. */
export async function applyCta(actor: RequestActor, input: z.infer<typeof ctaApplySchema>) {
  const ownerId = input.ownerId ?? actor.id, token = await managed(actor, ownerId);
  const items: CtaItem[] = [];
  for (const videoId of [...new Set(input.videoIds)]) {
    try {
      const done = await setDescription(token, videoId, current => { const plan = ctaPlan(current, input.find, input.replace); return "next" in plan ? plan.next ?? null : null; });
      items.push({ videoId, title: done.title, before: done.before, after: done.after, ok: done.changed, ...(done.changed ? {} : { error: "찾을 말이 없어요" }) });
    } catch (error) { items.push({ videoId, title: "", before: "", after: "", ok: false, error: error instanceof ApiError ? error.message : "바꾸지 못했어요" }); }
  }
  const change: CtaChange = { id: randomUUID(), at: new Date().toISOString(), by: actor.name, find: input.find, replace: input.replace, items };
  const { error } = await createServiceSupabase().from("os_records").insert(changeRecord(change, actor));
  if (error) console.warn(`cta change record skipped (${error.code ?? "error"})`);
  await auditChannelAction(actor.id, ownerId, "youtube", `설명란 일괄 바꾸기 ${items.filter(item => item.ok).length}개`);
  return { change: summary(change) };
}

/** Puts each changed description back, unless someone changed it again since. */
export async function undoCta(actor: RequestActor, input: z.infer<typeof ctaUndoSchema>) {
  const ownerId = input.ownerId ?? actor.id, token = await managed(actor, ownerId);
  const service = createServiceSupabase();
  const { data } = await service.from("os_records").select("id,metadata").eq("id", input.changeId).eq("metadata->>packageKind", "yp_cta_change").is("archived_at", null).maybeSingle();
  const change = data?.metadata?.change as CtaChange | undefined;
  if (!change) throw new ApiError(404, "CTA_CHANGE_NOT_FOUND", "그 바꾸기 기록을 찾지 못했어요.");
  if (change.undoneAt) throw new ApiError(409, "CTA_ALREADY_UNDONE", "이미 되돌렸어요.");
  const items: CtaItem[] = [];
  for (const item of change.items) {
    if (!item.ok || item.undone) { items.push(item); continue; }
    try {
      const done = await setDescription(token, item.videoId, current => ctaUndoable(current, item) ? item.before : null);
      items.push(done.changed ? { ...item, undone: true } : { ...item, error: "바꾼 뒤 또 고쳐져서 그대로 뒀어요" });
    } catch (error) { items.push({ ...item, error: error instanceof ApiError ? error.message : "되돌리지 못했어요" }); }
  }
  const next: CtaChange = { ...change, items, undoneAt: new Date().toISOString() };
  await service.from("os_records").update({ metadata: { packageKind: "yp_cta_change", change: next }, updated_by: actor.id }).eq("id", change.id);
  await auditChannelAction(actor.id, ownerId, "youtube", `설명란 일괄 되돌리기 ${items.filter(item => item.undone).length}개`);
  return { change: summary(next) };
}

/** What the screen shows of a change: counts and titles, not the whole descriptions. */
function summary(change: CtaChange) {
  return { id: change.id, at: change.at, by: change.by, find: change.find, replace: change.replace, undoneAt: change.undoneAt ?? null,
    done: change.items.filter(item => item.ok).length, undone: change.items.filter(item => item.undone).length, failed: change.items.filter(item => !item.ok).map(item => ({ videoId: item.videoId, error: item.error ?? "" })) };
}
export type CtaChangeSummary = ReturnType<typeof summary>;

export async function ctaHistory() {
  const { data } = await createServiceSupabase().from("os_records").select("metadata").eq("record_type", "content_package").eq("metadata->>packageKind", "yp_cta_change")
    .is("archived_at", null).order("created_at", { ascending: false }).limit(20);
  return (data ?? []).map(row => summary(row.metadata.change as CtaChange));
}
