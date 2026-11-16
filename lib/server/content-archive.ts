// 아카이브 화면 (수정 요청 2026-11-13, 2단계): the reference documents the Telegram rooms fill (03_Content/레퍼런스/{주제}) as cards.
// They are read with the member's own access (team documents); a 상태 or 주제 change is written by the server once the member can read
// the card, with who changed it written into the document.
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { ARCHIVE_FOLDER, ARCHIVE_STATES, ARCHIVE_TOPICS, readArchive, withArchiveChange } from "@/lib/telegram-archive";
import { parseYoutubeRef } from "@/lib/youtube-process/project";
import type { RequestActor } from "./auth";

const LIMIT = 500;
const SIGN_SECONDS = 1_800;

export async function listArchive(actor: RequestActor) {
  const { data, error } = await actor.supabase.from("os_documents").select("id,title,folder,content_md,current_version,created_at,updated_at")
    .like("folder", `${ARCHIVE_FOLDER}/%`).neq("status", "archived").order("created_at", { ascending: false }).limit(LIMIT);
  if (error) throw new ApiError(500, "ARCHIVE_READ_FAILED", "아카이브를 읽지 못했어요.");
  const rows = (data ?? []).map((doc) => ({ doc, card: readArchive(String(doc.content_md ?? "")) }));
  // A picture kept from the room sits in the private media bucket: a short-lived address for the cards the member can read.
  const service = createServiceSupabase();
  const images = await Promise.all(rows.map(async ({ card }) => {
    const path = card.image.startsWith("os-content-media/") ? card.image.slice("os-content-media/".length) : "";
    if (!path) return "";
    const { data: signed } = await service.storage.from("os-content-media").createSignedUrl(path, SIGN_SECONDS);
    return signed?.signedUrl ?? "";
  }));
  return { cards: rows.map(({ doc, card }, i) => ({ id: doc.id as string, version: doc.current_version as number, title: String(doc.title ?? ""),
    folderTopic: String(doc.folder ?? "").slice(ARCHIVE_FOLDER.length + 1), createdAt: String(doc.created_at ?? ""), ...card, image: images[i] })),
    topics: ARCHIVE_TOPICS, states: ARCHIVE_STATES, truncated: rows.length === LIMIT };
}

export const archiveChangeSchema = z.object({ id: z.string().uuid(), version: z.number().int().min(1),
  state: z.enum(ARCHIVE_STATES).optional(), topic: z.enum(ARCHIVE_TOPICS).optional() }).strict().refine((input) => input.state || input.topic, "바꿀 상태나 주제를 골라 주세요.");

/** A card the member can read (their own access), as the archive screen shows it. */
async function readCard(actor: RequestActor, id: string) {
  const { data, error } = await actor.supabase.from("os_documents").select("id,title,folder,content_md,current_version")
    .eq("id", id).like("folder", `${ARCHIVE_FOLDER}/%`).neq("status", "archived").maybeSingle();
  if (error) throw new ApiError(500, "ARCHIVE_READ_FAILED", "카드를 읽지 못했어요.");
  if (!data) throw new ApiError(404, "ARCHIVE_CARD_NOT_FOUND", "볼 수 있는 아카이브 카드가 아니에요.");
  return data;
}

export const archiveKeepSchema = z.object({ id: z.string().uuid() }).strict();
/**
 * 3단계 「담아 둔 영상에 담기」: a YouTube video card becomes a 틈새 재료 (주제 찾기 › 롱폼 › 담아 둔 영상) — the same record the 기획실's
 * own [담기] makes — unless that video is kept already. The card turns 주제 후보 either way. Other links have no 틈새 (it is counted by
 * YouTube video id), so they go to a 숏폼 · 광고 or a 스레드 글감 instead.
 */
export async function keepArchiveVideo(actor: RequestActor, input: z.infer<typeof archiveKeepSchema>) {
  const doc = await readCard(actor, input.id);
  const card = readArchive(String(doc.content_md ?? ""));
  const ref = parseYoutubeRef(card.link);
  if (!ref) throw new ApiError(422, "ARCHIVE_NOT_YOUTUBE_VIDEO", "유튜브 영상 링크만 담아 둔 영상에 담을 수 있어요.");
  const { data: kept, error: keptError } = await actor.supabase.from("os_records").select("id").eq("record_type", "content_topic")
    .eq("metadata->>studioKind", "outlier").eq("metadata->>youtubeId", ref.videoId).is("archived_at", null).limit(1).maybeSingle();
  if (keptError) throw new ApiError(500, "ARCHIVE_KEEP_READ_FAILED", "담아 둔 영상을 확인하지 못했어요.");
  let recordId = kept?.id as string | undefined;
  if (!recordId) {
    const title = String(doc.title ?? "").trim() || card.note.split("\n")[0] || ref.url;
    const views = Number(card.views) || null;
    const { data, error } = await actor.supabase.from("os_records").insert({ record_type: "content_topic", title: title.slice(0, 240),
      description: `텔레그램 아카이브(${card.room})에서 ${card.who}님이 올린 영상`, status: "review", priority: "normal", stage: "레퍼런스", brand: "", team: actor.team,
      source_url: ref.url, metric_current: views, metric_unit: "조회", tags: ["레퍼런스", "틈새재료", "아카이브"], owner_id: actor.ownerId, created_by: actor.ownerId, updated_by: actor.ownerId,
      metadata: { studioKind: "outlier", discoverySource: "keyword", baseline: null, youtubeId: ref.videoId, channelId: null, channelTitle: card.channel || "",
        thumbnail: card.thumbnail || `https://i.ytimg.com/vi/${ref.videoId}/hqdefault.jpg`, videoPublishedAt: null, views, subscribers: null, median: null, ratio: null,
        viewSubscriberRatio: null, durationSeconds: null, query: "텔레그램 아카이브", archiveDocumentId: doc.id } }).select("id").single();
    if (error) throw new ApiError(500, "ARCHIVE_KEEP_FAILED", "담아 둔 영상에 담지 못했어요.");
    recordId = data.id as string;
  }
  const changed = card.state === "주제 후보" ? { id: doc.id as string, version: doc.current_version as number }
    : await changeArchive(actor, { id: doc.id as string, version: doc.current_version as number, state: "주제 후보" });
  return { recordId, existed: Boolean(kept), ...changed };
}

/** 상태 or 주제 (the folder moves with it — a person moving a card is the answer); stale versions are refused, never overwritten. */
export async function changeArchive(actor: RequestActor, input: z.infer<typeof archiveChangeSchema>) {
  const { data: seen, error: seenError } = await actor.supabase.from("os_documents").select("id,folder,content_md,current_version")
    .eq("id", input.id).like("folder", `${ARCHIVE_FOLDER}/%`).neq("status", "archived").maybeSingle();
  if (seenError) throw new ApiError(500, "ARCHIVE_READ_FAILED", "카드를 읽지 못했어요.");
  if (!seen) throw new ApiError(404, "ARCHIVE_CARD_NOT_FOUND", "볼 수 있는 아카이브 카드가 아니에요.");
  if (seen.current_version !== input.version) throw new ApiError(409, "ARCHIVE_CARD_CHANGED", "다른 사람이 먼저 바꿨어요. 목록을 새로 불러왔어요.");
  const content = withArchiveChange(String(seen.content_md ?? ""), { state: input.state, topic: input.topic }, actor.name || "구성원", new Date().toISOString());
  const { data, error } = await createServiceSupabase().from("os_documents").update({ content_md: content, ...(input.topic ? { folder: `${ARCHIVE_FOLDER}/${input.topic}` } : {}) })
    .eq("id", input.id).eq("current_version", input.version).select("id,current_version").maybeSingle();
  if (error || !data) throw new ApiError(409, "ARCHIVE_CARD_CHANGED", "다른 사람이 먼저 바꿨어요. 목록을 새로 불러왔어요.");
  return { id: data.id as string, version: data.current_version as number };
}
