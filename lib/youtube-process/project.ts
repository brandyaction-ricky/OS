// 유튜브 공정 v1 project rules shared by the API, the screens and the demo store (지시서 6-2 · 8-1).
import { editableFields } from "./confirm.ts";
export type YpStage = "topic" | "draft" | "outline" | "make" | "review" | "upload" | "shorts" | "done";
export type YpKind = "live" | "anim" | "short" | "card";
export type YpGate = "topic" | "draft" | "review" | "shorts";
export type YpGateState = "none" | "wait" | "changes" | "hold" | "ok";
/** self: the PD confirmed it themselves (owner decision 2026-10-26: every confirm is the PD's; the 대표 is told and leaves notes). */
export interface YpGateInfo { state: YpGateState; round: number; requestedAt?: string; requestedBy?: string; decidedAt?: string; decidedBy?: string; fields?: string[]; memo?: string; reason?: string; self?: boolean }
/** A note the 대표 leaves on a step the PD confirmed; the PD is told and reads it on that step. */
export interface YpGateNote { gate: YpGate; at: string; by: string; name: string; text: string }
export interface YpRef { url: string; videoId?: string; title?: string }
/** purpose "ad": a 숏폼 made as a Meta ad (주제 찾기 › 광고, 2026-10-28); its references are ads and its script follows the ad principles. */
export interface YpTopic { type: YpKind | null; target: string; note: string; refs: YpRef[]; purpose?: "ad" | null }
export interface YpMeta {
  v: 1; stage: YpStage; topic: YpTopic; gates: Record<YpGate, YpGateInfo>; contentUpdatedAt: string; multiFrom?: string;
  /** 쇼츠 확정 by the PD (owner decision 2026-10-25): each confirmed clip's script as it was confirmed (clipSignature); a later change needs a new 확정. */
  shortsConfirmed?: { at: string; by: string; clips: Record<string, string> };
  /** 쇼츠 확정 · 코멘트 기록, newest last: the 대표 reads it in 대표 메뉴 › 컨펌 and comments when something should change. */
  shortsLog?: YpShortsLogEntry[];
  /** 대표 노트, newest last. */
  notes?: YpGateNote[];
  /** A 숏폼 made from a longform's 숏폼 주제 후보 (입구 A, 2026-10-28): the longform and the candidate, for the 대본 step. */
  shortFrom?: { projectId: string; title: string; topicId: string; scene: string; paragraph: string };
  /** A 카드뉴스 made from a finished longform · 숏폼 or an approved Threads post (설계서 2026-10-30, 입구 넷): where its text came from. */
  cardFrom?: { kind: "longform" | "short" | "threads"; id: string; title: string };
}
export interface YpShortsLogEntry { at: string; by: string; byName: string; kind: "confirm" | "comment"; text: string; count?: number }
export interface YpProject { id: string; version: number; title: string; assigneeId: string | null; ownerId: string; updatedAt: string; yp: YpMeta }

export const YP_FLOW = ["주제", "기획안", "구성안", "제작", "최종 검토", "업로드", "쇼츠 · 칼럼"] as const;
export const YP_STAGE_INDEX: Record<YpStage, number> = { topic: 0, draft: 1, outline: 2, make: 3, review: 4, upload: 5, shorts: 6, done: 7 };
export const YP_KIND_LABEL: Record<YpKind, string> = { live: "롱폼 실사 촬영", anim: "롱폼 애니메이션", short: "숏폼 (릴스 · 광고)", card: "카드뉴스" };
export const YP_KIND_SHORT: Record<YpKind, string> = { live: "실사", anim: "애니메이션", short: "숏폼", card: "카드뉴스" };
/** A person as records name them: older records kept the e-mail, which is never shown whole (로건 QA 10/30). */
export const personName = (name?: string | null) => (name ?? "").split("@")[0];
/**
 * The steps a project goes through (index into YP_FLOW and the name shown). A 숏폼 (owner decision 2026-10-21) has no
 * 기획안 · 구성안 — what to make and the scenes sit in 제작 — and ends with 내보내기 instead of the YouTube upload and 쇼츠.
 * Its 기획안 place is the 대본 (숏폼 대본 정본, owner direction 2026-10-28: 주제 확정 and 대본 확정 decide a 숏폼).
 * A 카드뉴스 (설계서 2026-10-30) writes and designs its cards in one step (카드 만들기, in the 기획안 place) and is handed out by download.
 */
export function flowOf(kind: YpKind | null) {
  return kind === "short" ? [{ index: 0, name: "주제" }, { index: 1, name: "대본" }, { index: 3, name: "제작" }, { index: 4, name: "최종 검토" }, { index: 5, name: "내보내기" }]
    : kind === "card" ? [{ index: 0, name: "주제" }, { index: 1, name: "카드 만들기" }, { index: 4, name: "최종 검토" }, { index: 5, name: "내보내기" }]
    : YP_FLOW.map((name, index) => ({ index, name: name as string }));
}
export const stepName = (index: number, kind: YpKind | null) => flowOf(kind).find(step => step.index === index)?.name ?? YP_FLOW[index] ?? "완료";
export const YP_MAX_LINES = 20;
export const YP_RECENT = 6;

export function topicLines(title: string) {
  return title.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

/** The one-line reason the topic confirm request is not ready, or "" (시안 topicMissing). */
export function topicMissing(title: string, topic: Pick<YpTopic, "type" | "target">) {
  const lines = topicLines(title);
  if (!lines.length) return "주제를 써 주세요";
  if (lines.length > YP_MAX_LINES) return `주제는 한 번에 ${YP_MAX_LINES}줄까지 보낼 수 있어요`;
  if (!topic.type) return "유형을 골라 주세요";
  if (!topic.target.trim()) return "정밀 타겟을 써 주세요";
  return "";
}

export function emptyGates(): Record<YpGate, YpGateInfo> {
  return { topic: { state: "none", round: 0 }, draft: { state: "none", round: 0 }, review: { state: "none", round: 0 }, shorts: { state: "none", round: 0 } };
}

export function newProjectMeta(topic: YpTopic, now: string, multiFrom?: string) {
  const yp: YpMeta = { v: 1, stage: "topic", topic, gates: emptyGates(), contentUpdatedAt: now, ...(multiFrom ? { multiFrom } : {}) };
  return { workflow: "youtube_v1" as const, yp };
}

type ProjectRow = { id: string; version: number; title: string; assignee_id?: string | null; owner_id: string; updated_at: string; metadata?: Record<string, unknown> | null };
export function projectFromRecord(row: ProjectRow): YpProject | null {
  const yp = row.metadata?.yp as YpMeta | undefined;
  if (row.metadata?.workflow !== "youtube_v1" || yp?.v !== 1) return null;
  // Projects made before a gate existed (쇼츠 컨펌, 2026-10-25) read it as not yet requested.
  return { id: row.id, version: row.version, title: row.title, assigneeId: row.assignee_id ?? null, ownerId: row.owner_id, updatedAt: row.updated_at, yp: { ...yp, gates: { ...emptyGates(), ...yp.gates } } };
}

/** 내 영상 휴지통 (staff request 2026-10-26): a trashed project keeps 30 days, then an admin may purge it — the company rule is that a person approves 영구 삭제. */
export const TRASH_KEEP_DAYS = 30;
export interface YpTrash { at: string; by: string; name: string; reason: string; stage: YpStage }
export interface YpTrashed { project: YpProject; trash: YpTrash }
export const trashDaysLeft = (at: string, now = Date.now()) => Math.max(0, TRASH_KEEP_DAYS - Math.floor((now - Date.parse(at)) / 86_400_000));
/** Who may trash or restore a video: the person who made it, its PD, or an admin. */
export const mayTrash = (project: Pick<YpProject, "ownerId" | "assigneeId">, who: string | undefined, admin: boolean) => admin || Boolean(who && (project.ownerId === who || project.assigneeId === who));

/** Project name = first topic line (4-2); stays as the record title. */
export const projectName = (project: Pick<YpProject, "title">) => topicLines(project.title)[0] ?? "새 영상";
// Words that say nothing about the topic on their own (로건 QA 10/30: 「하루 일이 두」 found 귤 · 결혼 · 아기 videos).
// ponytail: a word list and endings, not a Korean parser — the PD still sees and changes the words, and 「검색어를 바꿔 보세요」 catches a miss.
const PLAIN = new Set(["하루", "오늘", "매일", "자꾸", "계속", "정말", "너무", "진짜", "그냥", "아주", "가장", "제일", "요즘", "이런", "그런", "저런", "어떤", "무엇",
  "해야", "하는", "있는", "없는", "되는", "같은", "같은데", "같다", "이유", "방법", "때문", "우리", "사람", "모든", "다른", "지금", "이제", "바로", "먼저", "아직", "많이",
  "조금", "없이", "위해", "대한", "하고", "하면", "해도", "아니라", "아닌", "아니다", "사이", "싶은", "싶은데", "싶을", "싶다", "할까", "할지", "좋은", "좋다",
  "아니에요", "아니야", "뭔지", "모를", "모르는", "이렇게", "어떻게", "일이", "일을", "일은", "일도", "일에"]);
const TAIL = /(을|를|이|가|의|에|에서|에게|한테|으로|로|도|만|마다|까지|부터|와|과|랑|이랑|처럼|보다|뿐인데|인데|뿐)$/u;
const DOING = /(하는|해야|해서|하고|하면|하기|하며|하던|했던|한다|해요|할|한|해)$/u; // 고민하는 → 고민, 이직해야 → 이직
const VERB = /(고|은|을|다|면|서|게|까|데|요|며|도록|던)$/u;
const stem = (word: string, tail: RegExp) => { const cut = word.replace(tail, ""); return [...cut].length > 1 ? cut : word.length - cut.length > 1 ? "" : word; };
/** The words of a sentence that carry its meaning, nouns first, then the 「…는」 situation (지치는 · 미루는), then other verb forms. */
export function topicWords(text: string) {
  const words = text.normalize("NFC").replace(/\[[^\]]*\]/g, " ").split(/[^0-9A-Za-z가-힣]+/).map(word => stem(stem(word, TAIL), DOING))
    .filter(word => [...word].length > 1 && (!/\d/.test(word) || /^\d+대$/.test(word)) && !PLAIN.has(word));
  return { nouns: words.filter(word => !word.endsWith("는") && !VERB.test(word)), doing: words.filter(word => word.endsWith("는")), verbs: words.filter(word => !word.endsWith("는") && VERB.test(word)) };
}
/**
 * The YouTube search words for a topic (로건 QA 10/30): two words that carry the sentence's meaning — its nouns, its 「…는」 situation,
 * else the 정밀 타겟's nouns — and the 정밀 타겟's last word, who it is for (「…3~7년 차 직장인」 → 직장인): 「저녁 지치는 직장인」, not the
 * sentence's first three words. The PD can still change them.
 */
export function topicKeywords(title: string, target = "") {
  const head = topicWords(title), them = topicWords(target), who = them.nouns.at(-1);
  const pick = [...new Set([...head.nouns, ...head.doing, ...them.nouns.slice(0, -1), ...head.verbs])].filter(word => word !== who);
  const strong = pick.filter(word => !head.verbs.includes(word));
  const words = who ? [...pick.slice(0, 2), who] : (strong.length > 1 ? strong : pick).slice(0, 3);
  return (words.length ? words : title.replace(/\[[^\]]*\]/g, " ").trim().split(/\s+/).slice(0, 3)).join(" ").slice(0, 60);
}

/** Some topic field can change: while writing, on hold, or the fields ticked in 수정 요청 (8-1, editableFields). */
export function topicEditable(project: Pick<YpProject, "yp">) {
  const fields = editableFields(project, "topic");
  return fields === "all" || fields.length > 0;
}
/** Topic edit keys (API and form) and the field keys the approver ticks. */
export const TOPIC_FIELD_OF = { title: "topic.title", kind: "topic.type", target: "topic.target", refs: "topic.refs", note: "topic.note", purpose: "topic.type" } as const;
export function topicFieldEditable(project: Pick<YpProject, "yp">, key: keyof typeof TOPIC_FIELD_OF) {
  const fields = editableFields(project, "topic");
  return fields === "all" || fields.includes(TOPIC_FIELD_OF[key]);
}

export function recentProjects<T extends Pick<YpProject, "yp">>(projects: T[], limit = YP_RECENT) {
  return [...projects].sort((a, b) => b.yp.contentUpdatedAt.localeCompare(a.yp.contentUpdatedAt)).slice(0, limit);
}

export function searchProjects<T extends Pick<YpProject, "title">>(projects: T[], query: string) {
  const q = query.trim().toLocaleLowerCase("ko-KR");
  return q ? projects.filter(project => project.title.toLocaleLowerCase("ko-KR").includes(q)) : projects;
}

// Bracketed labels such as [예시] or [시험] are not topic words, and neither are the words every title uses (usability QA
// 2026-10-25: 이유 · 가지 · 일이 raised "비슷한 주제" on unrelated videos) or counts such as 4칸 · 30초.
// ponytail: fixed common-word list; grow it when a new filler word starts raising false matches.
const COMMON = new Set(["이유", "방법", "가지", "하는", "하기", "하는법", "것", "때", "진짜", "정말", "먼저", "처음", "다시", "이야기", "정리", "정리하는",
  "시작", "시작하기", "생각", "일이", "일을", "일은", "사람", "우리", "너무", "가장", "모든", "없이", "있는", "없는", "위한", "대한", "전에", "하나", "만들기", "알아야", "해야", "할", "꼭"]);
const words = (text: string) => new Set(text.replace(/\[[^\]]*\]/g, " ").toLocaleLowerCase("ko-KR").split(/[^\p{L}\p{N}]+/u)
  .filter(word => word.length >= 2 && !COMMON.has(word) && !/^\d/.test(word)));
/** Earlier projects sharing words with the topic's first line (keyword match, not AI). Most shared words first. */
export function similarProjects<T extends Pick<YpProject, "id" | "title">>(title: string, projects: T[], selfId?: string, limit = 3) {
  const mine = words(topicLines(title)[0] ?? "");
  if (!mine.size) return [];
  return projects
    .filter(project => project.id !== selfId)
    .map(project => ({ project, shared: [...words(projectName(project))].filter(word => mine.has(word)).length }))
    .filter(hit => hit.shared > 0)
    .sort((a, b) => b.shared - a.shared)
    .slice(0, limit)
    .map(hit => hit.project);
}

/** A YouTube watch, short or youtu.be link, normalized; null for anything else. */
/** The same video twice in a reference list (by video id, else by address): 「이미 있어요」 (로건 피드백 A-2). */
export const sameRef = (a: YpRef, b: YpRef) => a.videoId && b.videoId ? a.videoId === b.videoId : a.url === b.url;
export function parseYoutubeRef(input: string): YpRef | null {
  let url: URL;
  try { url = new URL(input.trim()); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^(www|m)\./, "");
  const id = host === "youtu.be" ? url.pathname.slice(1)
    : host === "youtube.com" ? (url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.match(/^\/(?:shorts|live)\/([^/]+)/)?.[1]) : null;
  if (!id || !/^[\w-]{11}$/.test(id)) return null;
  return { url: `https://www.youtube.com/watch?v=${id}`, videoId: id };
}

/** Projects are saved only through the 유튜브 공정 API, never through the generic records API (6-5). */
export function protectedYoutubeChange(current: Record<string, unknown> | null | undefined, proposed: Record<string, unknown> | null | undefined) {
  return current?.workflow === "youtube_v1" || proposed?.workflow === "youtube_v1";
}

const PLAN_VIEWS = ["topic", "draft", "outline"] as const;
/** Screen for flow step i (0 주제 … 6 쇼츠) of a project. */
export function stepHref(index: number, id: string) {
  if (index <= 2) return `/content/plan?project=${encodeURIComponent(id)}&view=${PLAN_VIEWS[index]}`;
  return [`/content/make?project=${encodeURIComponent(id)}`, `/content/final-check?project=${encodeURIComponent(id)}&tab=video`, `/content/upload?project=${encodeURIComponent(id)}`, `/content/shorts?project=${encodeURIComponent(id)}`][index - 3];
}
/** Where a project row opens: its current step (a finished project opens its topic). */
// A finished video opens on its last step (쇼츠 · 칼럼 or 내보내기), where its results are, not on 주제.
export const projectHref = (project: Pick<YpProject, "id" | "yp">) => stepHref(project.yp.stage === "done" ? flowOf(project.yp.topic.type).at(-1)!.index : YP_STAGE_INDEX[project.yp.stage], project.id);
export const stageLabel = (project: Pick<YpProject, "yp">) => project.yp.stage === "done" ? "완료" : stepName(YP_STAGE_INDEX[project.yp.stage], project.yp.topic.type);
