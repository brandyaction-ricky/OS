// 카드뉴스 (설계서 2026-10-30): four ways in, one way through. A finished longform or 숏폼, an approved Threads post, or a topic typed
// in 주제 찾기 becomes a 카드뉴스 project whose topic is already confirmed by the PD who made it; its cards record keeps a copy of the
// text it came from. The PNGs are drawn from the cards on request (next/og) and never stored.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createElement } from "react";
import { ImageResponse } from "next/og";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { CardSlideView } from "@/lib/cardnews/card-slide";
import { CardError, cardsMissing, nextCards, pickedDraft } from "@/lib/cardnews/cards";
import { CAPTION_MAX, CARD_FORMAT_IDS, CARD_MAX_SLIDES, CARD_SIZE, cardSignature, type CardDraft } from "@/lib/cardnews/formats";
import { storedZip } from "@/lib/cardnews/zip";
import { projectCardSources, visibleThreadSource, type CardSourceChoice } from "@/lib/cardnews/sources";
import { applyGateAction, quietHours } from "@/lib/youtube-process/confirm";
import { newProjectMeta, projectName, type YpProject } from "@/lib/youtube-process/project";
import { emptyStage, stageData, STAGE_RECORD, type YpCards, type YpCardSource } from "@/lib/youtube-process/stages";
import { narrationFromMarkdown } from "@/lib/youtube-narration-document";
import type { RequestActor } from "./auth";
import { approverIds, getYoutubeProject, insertProject, listYoutubeProjects, notify, recordConfirmation } from "./youtube-process";
import { readStages, writeStage } from "./youtube-process-stages";

const SOURCE_MAX = 60_000;

/** Discover only already-readable, approved sources. No source body or privileged service query in this list. */
export async function listCardSources(actor: RequestActor): Promise<CardSourceChoice[]> {
  const [projects, threads] = await Promise.all([
    listYoutubeProjects(actor),
    actor.supabase.from("os_records").select("id,title,status,owner_id,metadata,updated_at")
      .eq("record_type", "content_publish").eq("metadata->>channel", "threads").in("status", ["ready", "scheduled", "published"])
      .is("archived_at", null).order("updated_at", { ascending: false }).limit(200),
  ]);
  if (threads.error) throw new ApiError(503, "CARD_SOURCE_READ_FAILED", "완료한 주제를 불러오지 못했어요. 다시 시도해 주세요.");
  const posts: CardSourceChoice[] = (threads.data ?? []).filter(row => visibleThreadSource(row, actor.ownerId)).map(row => ({
    id: row.id, from: "threads", kind: "threads", title: String(row.title || "스레드 글").slice(0, 200), updatedAt: row.updated_at,
  }));
  return [...projectCardSources(projects), ...posts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** One bounded batch, not a full project bundle or a PNG render for each list row. RLS and visible parents both apply. */
export async function readCardCovers(actor: RequestActor, requested: string[]): Promise<Record<string, CardDraft>> {
  const projects = (await listYoutubeProjects(actor)).filter(project => project.yp.topic.type === "card" && requested.includes(project.id));
  const visible = projects.map(project => project.id);
  if (!visible.length) return {};
  const spec = STAGE_RECORD.cards;
  const { data, error } = await actor.supabase.from("os_records").select("parent_id,metadata")
    .eq("record_type", spec.recordType).eq(`metadata->>${spec.key}`, spec.value).in("parent_id", visible)
    .is("archived_at", null).order("updated_at", { ascending: false }).limit(200);
  if (error) throw new ApiError(503, "CARD_COVER_READ_FAILED", "표지를 불러오지 못했어요.");
  const covers: Record<string, CardDraft> = {};
  for (const row of data ?? []) {
    if (!row.parent_id || !visible.includes(row.parent_id) || covers[row.parent_id]) continue;
    const cards = stageData("cards", row.metadata?.yp, "card");
    const selected = projects.find(project => project.id === row.parent_id)?.yp.stage === "draft" ? cards.picked : cards.confirmed?.draftId || cards.picked;
    const draft = cards.drafts.find(item => item.id === selected) ?? cards.drafts[0];
    if (draft) covers[row.parent_id] = draft;
  }
  return covers;
}

export const cardCreateSchema = z.discriminatedUnion("from", [
  z.object({ from: z.literal("none"), title: z.string().trim().min(2).max(200), target: z.string().trim().min(1).max(300), note: z.string().max(2000).default("") }).strict(),
  z.object({ from: z.literal("project"), projectId: z.string().uuid(), focus: z.string().max(500).default("") }).strict(),
  z.object({ from: z.literal("threads"), itemId: z.string().uuid() }).strict(),
]);

/** The text a 카드뉴스 starts from: a longform's 원고 (spoken words) and A title, a 숏폼's confirmed 대본, or a Threads post's 글타래. */
async function sourceOf(actor: RequestActor, input: z.infer<typeof cardCreateSchema>, now: string) {
  if (input.from === "none") return { title: input.title, target: input.target, note: input.note, source: { kind: "none", title: input.title, text: "", at: now } as YpCardSource, focus: "" };
  if (input.from === "project") {
    const project = await getYoutubeProject(actor, input.projectId);
    const kind = project.yp.topic.type;
    if (kind === "card") throw new ApiError(400, "CARD_SOURCE_INVALID", "카드뉴스에서 다시 카드뉴스를 만들 수는 없어요.");
    // 최종 검토 OK 뒤에만: a 원고 or 대본 still moving would leave the 카드뉴스 behind it.
    if (!["upload", "shorts", "done"].includes(project.yp.stage)) throw new ApiError(409, "CARD_SOURCE_NOT_READY", "최종 검토 컨펌이 끝난 영상에서 카드뉴스를 만들 수 있어요.");
    const stages = await readStages(actor.supabase, project);
    const name = projectName(project);
    const text = kind === "short"
      ? [stages.shortScript.data.confirmed?.headCopy ?? stages.shortScript.data.headCopy, stages.shortScript.data.confirmed?.text ?? stages.shortScript.data.text].filter(Boolean).join("\n\n")
      : [stages.plan.data.confirmed?.A?.title ? `제목: ${stages.plan.data.confirmed.A.title}` : "", narrationFromMarkdown(stages.outline.data.script)].filter(Boolean).join("\n\n");
    if (!text.trim()) throw new ApiError(409, "CARD_SOURCE_EMPTY", kind === "short" ? "확정된 대본이 없어요." : "원고가 비어 있어요.");
    return { title: name, target: project.yp.topic.target || "원본 영상과 같아요", note: "", focus: input.focus.trim(),
      source: { kind: kind === "short" ? "short" : "longform", title: name, text: text.slice(0, SOURCE_MAX), at: now } as YpCardSource,
      from: { kind: kind === "short" ? "short" as const : "longform" as const, id: project.id, title: name } };
  }
  // A Threads post (콘텐츠 자동화): the writer's own, or one shared to the 팀 검토함, once approved.
  const { data: item, error } = await createServiceSupabase().from("os_records").select("id,title,status,owner_id,metadata").eq("id", input.itemId)
    .eq("record_type", "content_publish").is("archived_at", null).maybeSingle();
  if (error) throw new ApiError(503, "CARD_SOURCE_READ_FAILED", "스레드 글을 불러오지 못했어요.");
  if (!item || item.metadata?.channel !== "threads" || (item.owner_id !== actor.ownerId && item.metadata?.shared !== "team")) throw new ApiError(404, "CARD_SOURCE_NOT_FOUND", "스레드 글을 찾지 못했어요.");
  if (!["ready", "scheduled", "published"].includes(item.status)) throw new ApiError(409, "CARD_SOURCE_NOT_READY", "승인된 스레드 글에서 카드뉴스를 만들 수 있어요.");
  const posts = Array.isArray(item.metadata?.posts) ? (item.metadata.posts as unknown[]).map(String).filter(post => post.trim()) : [];
  if (!posts.length) throw new ApiError(409, "CARD_SOURCE_EMPTY", "스레드 글이 비어 있어요.");
  const title = String(item.title || posts[0].split("\n")[0]).slice(0, 200);
  return { title, target: "스레드 글과 같아요", note: "", focus: "", source: { kind: "threads", title, text: posts.join("\n\n").slice(0, SOURCE_MAX), at: now } as YpCardSource,
    from: { kind: "threads" as const, id: item.id as string, title } };
}

/** Makes the 카드뉴스 at 카드 만들기: its topic is confirmed by the PD who made it (the 대표 is told, as for any PD confirm). */
export async function createCardProject(actor: RequestActor, input: z.infer<typeof cardCreateSchema>) {
  const now = new Date().toISOString();
  const made = await sourceOf(actor, input, now);
  const meta = newProjectMeta({ type: "card", target: made.target, note: made.note, refs: [] }, now);
  meta.yp = { ...applyGateAction({ yp: meta.yp }, "topic", "confirm", { actor: actor.ownerId, now }), ...("from" in made && made.from ? { cardFrom: made.from } : {}) };
  const project = await insertProject(actor, made.title, actor.ownerId, meta);
  await writeStage(actor.supabase, actor.id, actor.team, project, "cards", { id: null, version: 0 }, { ...emptyStage("cards", "card"), source: made.source, focus: made.focus } satisfies YpCards);
  await recordConfirmation(project, "topic", "confirm", actor.ownerId, {});
  if (!quietHours(now)) await notify(await approverIds(), "yt_confirm_result", project.id, `self:${project.id}:topic:1`);
  return project;
}

// ── Saving the cards record ──
const fieldText = z.string().max(400);
const draftSchema = z.object({
  id: z.string().min(1).max(40), format: z.enum(CARD_FORMAT_IDS as [CardDraft["format"], ...CardDraft["format"][]]),
  slides: z.array(z.object({ type: z.enum(["cover", "item", "summary", "pair", "line", "end"]), fields: z.record(fieldText) }).strict()).min(1).max(CARD_MAX_SLIDES),
  caption: z.string().max(CAPTION_MAX + 400), hashtags: z.array(z.string().trim().min(1).max(60)).max(30),
}).strict();
export const cardsPatchSchema = z.object({
  /** A draft as edited (its AI record stays the server's), a new empty draft of a format, a draft removed, the one picked. */
  draft: draftSchema, add: z.enum(CARD_FORMAT_IDS as [CardDraft["format"], ...CardDraft["format"][]]), remove: z.string().max(40), pick: z.string().max(40),
  focus: z.string().max(500),
  /** 내보내기: where it went up (the address of the post). */
  exported: z.object({ url: z.string().url().max(500) }).strict(),
}).partial().strict();

export function nextCardsOnServer(project: YpProject, current: YpCards, patch: z.infer<typeof cardsPatchSchema>, actor: RequestActor, now: string) {
  try { return nextCards(project, current, patch, actor.name, now, () => crypto.randomUUID().slice(0, 8)); }
  catch (error) { throw error instanceof CardError ? new ApiError(error.status, error.code, error.message) : error; }
}
export { cardsMissing };

/** 카드 확정 fixes the picked draft (and how far it is from the AI's version). */
export async function fixConfirmedCards(actor: RequestActor, project: YpProject) {
  const service = createServiceSupabase();
  const stages = await readStages(service, project);
  const draft = pickedDraft(stages.cards.data);
  if (!draft) return;
  await writeStage(service, actor.id, actor.team, project, "cards", stages.cards,
    { ...stages.cards.data, confirmed: { at: new Date().toISOString(), draftId: draft.id, sig: cardSignature(draft), ...(draft.ai ? { aiSig: draft.ai.sig } : {}) } } satisfies YpCards);
}

// ── PNG · ZIP ──
let fonts: Promise<{ name: string; data: Buffer; weight: 400 | 700 | 800; style: "normal" }[]> | null = null;
// The same Pretendard the browser preview uses (public/fonts/pretendard), cut to three static weights: Satori reads no woff2.
const loadFonts = () => fonts ??= Promise.all(([400, 700, 800] as const).map(async weight =>
  ({ name: "Pretendard", data: await readFile(join(process.cwd(), "lib/cardnews/fonts", `Pretendard-${weight}.woff`)), weight, style: "normal" as const })));

export async function cardPng(draft: CardDraft, index: number) {
  const response = new ImageResponse(createElement(CardSlideView, { draft, index }), { ...CARD_SIZE, fonts: await loadFonts() });
  return new Uint8Array(await response.arrayBuffer());
}
/** One card as PNG, or every card of the draft as a ZIP; the confirmed draft unless another is named. */
export async function renderCards(actor: RequestActor, id: string, query: { draft?: string; slide?: number; zip?: boolean }) {
  const project = await getYoutubeProject(actor, id);
  if (project.yp.topic.type !== "card") throw new ApiError(404, "CARD_NOT_FOUND", "카드뉴스가 아니에요.");
  const cards = (await readStages(actor.supabase, project)).cards.data;
  const draft = cards.drafts.find(row => row.id === (query.draft || cards.confirmed?.draftId || cards.picked));
  if (!draft) throw new ApiError(404, "CARD_DRAFT_NOT_FOUND", "카드 초안을 찾지 못했어요.");
  if (!query.zip) {
    const index = query.slide ?? 0;
    if (!draft.slides[index]) throw new ApiError(404, "CARD_SLIDE_NOT_FOUND", "그 장이 없어요.");
    return { body: await cardPng(draft, index), type: "image/png", name: `card-${index + 1}.png` };
  }
  const files = [];
  for (let index = 0; index < draft.slides.length; index++) files.push({ name: `${String(index + 1).padStart(2, "0")}.png`, data: await cardPng(draft, index) });
  const caption = [draft.caption.trim(), draft.hashtags.map(tag => `#${tag.replace(/^#/, "")}`).join(" ")].filter(Boolean).join("\n\n");
  if (caption) files.push({ name: "caption.txt", data: new TextEncoder().encode(caption) });
  return { body: new Uint8Array(storedZip(files)), type: "application/zip", name: "cardnews.zip" };
}
