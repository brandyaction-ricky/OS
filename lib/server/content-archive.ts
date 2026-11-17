// 아카이브 화면 (수정 요청 2026-11-13, 2단계): the reference documents the Telegram rooms fill (03_Content/레퍼런스/{주제}) as cards.
// They are read with the member's own access (team documents); a 상태 or 주제 change is written by the server once the member can read
// the card, with who changed it written into the document.
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { ARCHIVE_FOLDER, ARCHIVE_STATES, ARCHIVE_TOPICS, cardTitle, readArchive, withArchiveChange } from "@/lib/telegram-archive";
import { parseYoutubeRef, projectName, sameRef, YP_KIND_LABEL } from "@/lib/youtube-process/project";
import { teamV1Enabled } from "@/lib/team/gate";
import type { RequestActor } from "./auth";
import { getYoutubeProject, listYoutubeProjects, youtubeV1Allowed } from "./youtube-process";
import { readStages, saveYoutubeStage } from "./youtube-process-stages";

// ponytail: one page of cards (≈0.4 KB each); a paged list when the rooms pass this.
const LIMIT = 2_000;
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
  // The folder is the card's 주제 (a move changes it); the temporary collection's cards mostly have no 주제 line in their header.
  const topicOf = (folder: string, header: string) => (ARCHIVE_TOPICS as readonly string[]).includes(folder) ? folder : header;
  return { cards: rows.map(({ doc, card }, i) => {
    const folderTopic = String(doc.folder ?? "").slice(ARCHIVE_FOLDER.length + 1);
    // The temporary collection kept no picture: a YouTube video shows its own thumbnail.
    const videoId = card.thumbnail ? "" : parseYoutubeRef(card.link)?.videoId;
    return { id: doc.id as string, version: doc.current_version as number, title: cardTitle(doc.title), folderTopic, createdAt: String(doc.created_at ?? ""),
      ...card, topic: topicOf(folderTopic, card.topic), image: images[i], thumbnail: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : card.thumbnail };
  }),
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
  return { ...data, title: cardTitle(data.title) };
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

// ── 회의 안건으로 (대표 2026-11-16: 「다가오는 회의에서 골라 붙이기」): one line at the end of a chosen meeting's 안건 ──
const teamOn = () => { if (!teamV1Enabled()) throw new ApiError(404, "TEAM_MENU_DISABLED", "팀 회의 기능이 꺼져 있어요."); };

/** The meetings not held yet (예정 · 진행 중) the member can see, soonest first. */
export async function upcomingMeetings(actor: RequestActor) {
  teamOn();
  const { data, error } = await actor.supabase.from("os_records").select("id,title,brand,status,starts_at,version")
    .eq("record_type", "meeting").eq("metadata->>workspace", "knowledge").in("status", ["planned", "active"]).is("archived_at", null)
    .order("starts_at", { ascending: true, nullsFirst: false }).limit(12);
  if (error) throw new ApiError(500, "ARCHIVE_MEETINGS_READ_FAILED", "다가오는 회의를 읽지 못했어요.");
  return { meetings: (data ?? []).map((row) => ({ id: row.id as string, title: String(row.title ?? ""), brand: String(row.brand ?? ""), status: String(row.status ?? ""),
    startsAt: (row.starts_at as string | null) ?? null })) };
}

/** A login wall's 「Instagram」 is no title: the note's first line (or the link) names the card instead. */
const cardName = (title: unknown, card: { platform: string; note: string; link: string }) =>
  String(title ?? "").trim() && String(title) !== card.platform ? String(title) : card.note.split("\n")[0] || card.link;

/** The 안건 line for a card: what it is, where, who brought it and why. */
export const agendaLine = (card: { link: string; who: string; note: string }, title: string) =>
  `- [레퍼런스] ${title.replace(/\s+/g, " ").slice(0, 80)}${card.link ? ` · ${card.link}` : ""} · ${card.who || "구성원"}${card.note ? `: ${card.note.split("\n")[0].slice(0, 120)}` : ""}`;

export const archiveMeetingSchema = z.object({ id: z.string().uuid(), meetingId: z.string().uuid() }).strict();
/** The card as one line at the end of the meeting's 안건 (what was written stays). The database lets only that meeting's attendees or an
 *  admin change it, and never a finished one; a card already there is not added twice. */
export async function addArchiveToMeeting(actor: RequestActor, input: z.infer<typeof archiveMeetingSchema>) {
  teamOn();
  const doc = await readCard(actor, input.id);
  const card = readArchive(String(doc.content_md ?? ""));
  const { data: meeting, error } = await actor.supabase.from("os_records").select("id,title,version,status,metadata")
    .eq("id", input.meetingId).eq("record_type", "meeting").is("archived_at", null).maybeSingle();
  if (error) throw new ApiError(500, "ARCHIVE_MEETINGS_READ_FAILED", "회의를 읽지 못했어요.");
  if (!meeting) throw new ApiError(404, "ARCHIVE_MEETING_NOT_FOUND", "볼 수 있는 회의가 아니에요.");
  const agenda = String((meeting.metadata as { agenda?: unknown } | null)?.agenda ?? "");
  const title = cardName(doc.title, card);
  if (card.link ? agenda.includes(card.link) : agenda.includes(agendaLine(card, title))) return { meetingId: meeting.id as string, added: false };
  const next = `${agenda.trimEnd()}${agenda.trim() ? "\n" : ""}${agendaLine(card, title)}`;
  const { error: saveError } = await actor.supabase.rpc("os_team_command", { p: { action: "meeting.save", id: meeting.id, expectedVersion: meeting.version, agenda: next } });
  if (saveError) {
    const why = saveError.message ?? "";
    if (/OS_MEETING_DENIED|OS_MEETING_REVIEW_LOCKED/.test(why)) throw new ApiError(403, "ARCHIVE_MEETING_DENIED", "그 회의의 참석자나 관리자만 안건을 붙일 수 있어요.");
    if (/OS_MEETING_LOCKED/.test(why)) throw new ApiError(409, "ARCHIVE_MEETING_LOCKED", "이미 끝난 회의예요. 다른 회의를 골라 주세요.");
    if (/OS_VERSION_CONFLICT/.test(why)) throw new ApiError(409, "ARCHIVE_MEETING_CHANGED", "회의가 방금 바뀌었어요. 다시 붙여 주세요.");
    throw new ApiError(502, "ARCHIVE_MEETING_SAVE_FAILED", "회의 안건에 붙이지 못했어요.");
  }
  return { meetingId: meeting.id as string, added: true };
}

// ── 썸네일 참고로 (요청 C 「썸네일 후보로 보내기」, 대표 2026-11-17 「썸네일 후보까지 만들자」): a YouTube video card joins a 기획안's
// 참고 영상 — what the 썸네일 후보 AI reads with each video's thumbnail (「왜 눌렸는지」), and the 기획안 AI too. Only a video still in
// 기획안 takes it; the 기획안's own save (who may edit, 컨펌 대기, version) decides the rest.
const v1On = async (actor: RequestActor) => { if (!(await youtubeV1Allowed(actor))) throw new ApiError(404, "YOUTUBE_V1_DISABLED", "유튜브 공정 화면을 사용할 수 없습니다."); };

/** The 롱폼 videos (실사 · 애니메이션) in 기획안 the member can see, the one worked on last first — 숏폼 · 카드뉴스 have no YouTube thumbnail
 *  (대표 2026-11-17 「롱폼만으로 좁혀줘」). */
export async function planVideos(actor: RequestActor) {
  await v1On(actor);
  const videos = (await listYoutubeProjects(actor)).filter((project) => project.yp.stage === "draft" && ["live", "anim"].includes(project.yp.topic.type ?? ""))
    .sort((a, b) => b.yp.contentUpdatedAt.localeCompare(a.yp.contentUpdatedAt)).slice(0, 30);
  return { videos: videos.map((project) => ({ id: project.id, title: projectName(project), kind: project.yp.topic.type ? YP_KIND_LABEL[project.yp.topic.type] : "" })) };
}

export const archivePlanSchema = z.object({ id: z.string().uuid(), projectId: z.string().uuid() }).strict();
export async function addArchiveToPlan(actor: RequestActor, input: z.infer<typeof archivePlanSchema>) {
  await v1On(actor);
  const doc = await readCard(actor, input.id);
  const card = readArchive(String(doc.content_md ?? ""));
  const ref = parseYoutubeRef(card.link);
  if (!ref) throw new ApiError(422, "ARCHIVE_NOT_YOUTUBE_VIDEO", "유튜브 영상 링크만 기획안 참고 영상에 넣을 수 있어요.");
  const project = await getYoutubeProject(actor, input.projectId);
  const { plan } = await readStages(actor.supabase, project);
  if ([...project.yp.topic.refs, ...plan.data.extraRefs].some((row) => sameRef(row, ref))) return { projectId: project.id, added: false };
  await saveYoutubeStage(actor, project.id, "plan", { expectedVersion: plan.version,
    patch: { extraRefs: [...plan.data.extraRefs, { ...ref, title: cardName(doc.title, card).slice(0, 200) }] } });
  return { projectId: project.id, added: true };
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
