// 유튜브 공정 v1 stage records (지시서 6-1 · 6-2): 기획안 · 구성안 · 제작 · 업로드 (+ SEO 칼럼, 2026-10-25), one child record each under the project.
// Rules here are shared by the API, the screens and the demo store.
import type { YpKind, YpRef } from "./project";
import type { CardDraft, CardFormatId } from "../cardnews/formats.ts";
import { narrationFromMarkdown } from "../youtube-narration-document.ts";

export type YpStageKind = "plan" | "outline" | "make" | "upload" | "column" | "shortTopics" | "shortScript" | "review2" | "screenCheck" | "topicResearch" | "cards";
export const STAGE_RECORD: Record<YpStageKind, { recordType: "content_package" | "content_script"; key: "packageKind" | "scriptKind"; value: string; title: string }> = {
  plan: { recordType: "content_package", key: "packageKind", value: "yp_plan", title: "기획안" },
  outline: { recordType: "content_script", key: "scriptKind", value: "yp_outline", title: "구성안" },
  make: { recordType: "content_package", key: "packageKind", value: "yp_make", title: "제작" },
  upload: { recordType: "content_package", key: "packageKind", value: "yp_upload", title: "업로드" },
  column: { recordType: "content_package", key: "packageKind", value: "yp_column", title: "SEO 칼럼" },
  shortTopics: { recordType: "content_package", key: "packageKind", value: "yp_short_topics", title: "숏폼 주제 후보" },
  shortScript: { recordType: "content_package", key: "packageKind", value: "yp_short_script", title: "숏폼 대본" },
  review2: { recordType: "content_package", key: "packageKind", value: "yp_review2", title: "두 번째 검수" },
  screenCheck: { recordType: "content_package", key: "packageKind", value: "yp_screen_check", title: "화면 자동 검사" },
  cards: { recordType: "content_package", key: "packageKind", value: "yp_cards", title: "카드뉴스" },
  topicResearch: { recordType: "content_package", key: "packageKind", value: "yp_topic_research", title: "롱폼 주제 후보" },
};
export const SLOTS = ["A", "B", "C"] as const;
export type YpSlot = (typeof SLOTS)[number];
/** Row i of the title or thumbnail list: A · B · C, then 예비. */
export const slotOf = (index: number): YpSlot | "예비" => index < SLOTS.length ? SLOTS[index] : "예비";

export interface YpThumb { id: string; mode: "img" | "text"; path?: string; screen?: string; copy?: string }
export interface YpPick { title: string; thumb: YpThumb | null }
export interface YpPlan {
  titles: { id: string; text: string }[]; thumbs: YpThumb[];
  opening: string; body: string; closing: string; note: string; extraRefs: YpRef[];
  /** The staff AI's last draft: who made it, and (when the PD had already written) the draft waiting beside the fields. */
  ai?: { by: string; model: string; at: string; jobId: string; patterns?: YpPatterns };
  aiDraft?: Pick<YpPlan, "titles" | "thumbs" | "opening" | "body" | "closing" | "note">;
  /** Copied when the 기획안 컨펌 is OK: the A · B · (C) pairs that later screens compare against. */
  confirmed?: { at: string } & Partial<Record<YpSlot, YpPick>>;
}
export interface YpScriptVersion { v: number; at: string; by: string; md: string; why: "manual" | "ai" | "make" | "restore"; model?: string }
export interface YpOutline {
  spec: { runtimeMin: number | null; res: string; fps: string; ratio: string };
  script: string; versions: YpScriptVersion[];
  /** The staff AI's working notes behind its draft (원고 공정 정본 §8-2): kept for reading, not edited. */
  ai?: { jobId: string; model: string; at: string; by: string; materials: string; axis: string; design: string; review: string; canonBundle: string; suggestions: string[]; head?: string };
}
export type YpMakeStatus = "prep" | "shoot" | "edit" | "done";
export interface YpFinalUpload { v: number; at: string; by: string; path: string; name: string; bytes: number }
export interface YpMake {
  editDue: string; status: YpMakeStatus; statusAt: Partial<Record<YpMakeStatus, string>>;
  /** 업로드 일정 (예상), set on the 스케줄 screen; never before 편집 완료 (4-9). */
  uploadPlan?: string;
  log: { at: string; by: string; from: string; to: string; why: string; field?: "editDue" | "uploadPlan" }[];
  /** Finals uploaded by hand (실사). The OS-made 마이인 finals come from their run records. */
  finals: YpFinalUpload[];
  thumbs: Partial<Record<YpSlot, { path: string; at: string; name: string }>>;
  /** 'A 제목 바꿔 보기' (S5) before 2026-10-25: a title different from the confirmed A, with the reason. Read through finalPair. */
  aTitle: string; aReason: string;
  /** 최종 썸네일 [고치기] (owner request 2026-10-25): a slot's title or thumbnail copy changed on purpose, with why. */
  edits?: Partial<Record<YpSlot, YpPairEdit>>;
  /** [공식대로 다시 뽑기]: the staff AI's last candidates for one slot, from the 패키징 정본 formula. */
  redo?: Partial<Record<YpSlot, YpRedo>>;
}
export interface YpPairEdit { title: string; copy: string; reason: string; at: string; by: string }
/** The formulas behind AI titles and copies (패키징 정본 작업 순서 2): the repeated words with [slots], how many references share them, and which. */
export interface YpPattern { skeleton: string; count: string; examples?: string[]; thumbs?: number[] }
/** market.off: most found videos share no word with the topic (「검색어를 바꿔 보세요」). */
export interface YpPatterns { titlePatterns: YpPattern[]; copyPatterns: { main: YpPattern[]; sub: YpPattern[] }; market?: { query: string; count: number; off?: boolean } }
export interface YpRedo extends Partial<YpPatterns> {
  at: string; by: string; model: string; jobId: string; market?: { query: string; count: number; off?: boolean };
  /** One-sentence formulas from the first 다시 뽑기 runs (before the patterns, 2026-10-25). */
  formula?: string; titleBasis?: string; copyFormula?: string; copyBasis?: string;
  titles: YpRedoPick[]; copies: YpRedoPick[];
}
export interface YpRedoPick { text: string; sub?: string; hook: string; pattern?: number; why: string }
export interface YpUpload {
  /** url: where the 진단 링크 goes (owner decision 2026-10-26: the MYIN mall); missing = 정밀 진단. */
  utm: { cat: string; dest: string; camp: string; next: string; short: string; url?: string;
    /** 로건 요청 10/30: the line said above the 이어서 볼 영상 link, and other places to send viewers (카페 · PPT …) with their own line. */
    nextNote?: string; others?: { note: string; url: string }[] };
  srt: { path: string; name: string } | null;
  desc: string; pinned: string; hiddenTags: string[];
  descBy: { userId: string; name: string; model: string; jobId: string; at: string; draft: string; title?: string } | null;
  /** A 숏폼's YouTube title (2026-10-25); a longform goes up with its confirmed A title instead. */
  title?: string;
  /** The AI's pinned comment when a person had already edited the description (shown beside it, not applied). */
  pinnedDraft?: string;
  /** The same AI pass's copy for other channels and the upload checklist (the earlier 유튜브 관리 kit). */
  extras?: { kakao: string; cafe: string; post: string; checklist: string[]; checked: number[] };
  privacy: "private" | "unlisted" | "public";
  /** 예약 (로건 요청 10/30): goes up private and YouTube makes it public at this time. */
  publishAt?: string | null;
  run: { at: string; by: string; status: "done" | "failed"; videoId?: string; videoUrl?: string; finalV?: number; thumbnail?: "ok" | "fail" | "skip"; error?: string;
    /** What YouTube reports after the upload: a project not yet audited by YouTube can only upload private. */
    privacy?: string; publishAt?: string } | null;
}
/** One SEO 칼럼 (owner request 2026-10-25): the staff AI's HTML from the 구성안 원고 (lib/seo-column.ts), and what fills its image places. */
export interface YpColumnItem {
  id: string;
  html: string;
  /** Per data-slot: an image the PD uploaded (path) or an address (url); the video place takes a YouTube link. */
  fills: Record<string, { path?: string; url?: string; name?: string }>;
  /** The AI's HTML as it arrived; a column whose HTML still equals it is replaced by the next AI pass, an edited one is kept. */
  ai: { by: string; model: string; at: string; jobId: string; html: string } | null;
  /** Where it went on the MYIN 아티클 (2026-10-25): sent as a draft, made public from OS; `sig` is what was sent, to show a later edit. */
  myin?: YpColumnMyin;
}
export interface YpColumnMyin { id: string; slug: string; status: "draft" | "published"; url: string; at: string; by: string; publishedAt: string | null; sig: string }
/** A short fingerprint of a column's HTML and places, compared with the one last sent to MYIN (the same on both sides). */
export function columnSignature(item: Pick<YpColumnItem, "html" | "fills">) {
  const text = `${item.html}\u0000${JSON.stringify(Object.entries(item.fills).sort(([a], [b]) => a.localeCompare(b)))}`;
  let hash = 5381;
  for (let index = 0; index < text.length; index++) hash = (hash * 33 + text.charCodeAt(index)) | 0;
  return `${text.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}
/** The columns of one longform: as many as the PD asked for, each aimed at its own search question. */
export interface YpColumn { items: YpColumnItem[] }
// 숏폼 대본 정본 (owner direction 2026-10-28): 입구 셋 · 길 하나 — 초안 주제(키워드 · 링크) → 레퍼런스 → 공식 뽑기 → 주제 확정(PD) → 우리 말로 대본 → 대본 확정(PD).
/** 입구 A on a longform: the staff AI's 숏폼 주제 후보 from the 원고 (통찰 한 줄 + 장면 하나 + 어느 문단), and the 숏폼 made from each. */
export interface YpShortTopic { id: string; insight: string; scene: string; paragraph: string; why: string; made?: { projectId: string; at: string; by: string } }
export interface YpShortTopics { items: YpShortTopic[]; ai?: { by: string; model: string; at: string; jobId: string } }
/** A 레퍼런스 the PD added by hand; script = what is said in it, pasted (the AI reads titles only otherwise). */
/** Counts the PD (or Aside) read off the page, for a link the render PC cannot open (Reels without a login): 반응도 기준 from them. */
export interface YpShortRef { url: string; title: string; script: string; views?: number | null; likes?: number | null; followers?: number | null }
/**
 * One formula for the company 공식 창고 (§2-3 · §2-4): blanks only, no words of the reference. head = the first screen's 헤드 카피
 * (owner 2026-10-28: the most important), cover = the thumbnail copy, hook = the first spoken sentence, flow = the beats.
 */
export interface YpShortFormula { name: string; head: string; cover: string; hook: string; flow: string; why: string; refs: string[] }
/** A formula as the 공식 창고 keeps it: who added it and how many 대본 used it. */
export interface YpStoredFormula extends YpShortFormula { at: string; by: string; uses: number }
export interface YpShortHook { kind: "반전형" | "직격형"; text: string }
/** A 주제 후보 the staff AI drew from the references' formulas (owner 2026-10-28: 주제는 참고 영상 · 공식을 본 뒤에 정한다). */
export interface YpShortTopicPick { title: string; insight: string; formula: string; why: string }
/** A 숏폼's 대본 step: the search and references behind it, the formula used and the script (한 줄 = 한 문장 = 화면 한 장). */
export interface YpShortScript {
  query: string; refs: YpShortRef[]; text: string; hooks: YpShortHook[]; insight: string; formula: string;
  /** The big words on this 숏폼's first screen (헤드 카피), over the first three seconds. */
  headCopy: string;
  ai?: { by: string; model: string; at: string; jobId: string; market?: { query: string; count: number }; picked: { title: string; url: string; views: number }[]; formulas: YpShortFormula[]; notes: string; text: string };
  /** 주제 step (owner 2026-10-28): the formulas the staff AI drew from the references and the 주제 후보 made from them; the PD fixes one. */
  research?: { by: string; model: string; at: string; jobId: string; market?: { query: string; count: number }; picked: { title: string; url: string; views: number }[]; formulas: YpShortFormula[]; topics: YpShortTopicPick[]; notes: string };
  /** The AI's script when the PD had already written: shown beside the fields, applied only on [이 초안으로 바꾸기]. */
  aiDraft?: Pick<YpShortScript, "text" | "hooks" | "insight" | "formula" | "headCopy">;
  /** Copied when the 대본 확정 is made: what 제작 starts from (headCopy since 2026-10-28; older ones read the step's headCopy). */
  confirmed?: { at: string; text: string; headCopy?: string };
}
/** 원고 검수 정본 관문 2~6 as GPT judged them (owner 2026-10-29: the 별도 판정 of 공정 정본 §12-3 by another company's model). Its own
 * record beside the 구성안, so a judgement landing while the PD types never bumps the 구성안 version. */
export interface YpReview2Item { paragraph: number; quote: string; grade: "상" | "중" | "하"; reason: string; fix: string }
export interface YpReview2 {
  state: "none" | "running" | "done" | "failed"; at: string; model: string;
  /** scriptKey() of the 원고 judged: when the 구성안 changes, the screen says the judgement is for an older 원고. */
  key: string; pass?: boolean; gates: { gate: 2 | 3 | 4 | 5 | 6; pass: boolean; items: YpReview2Item[] }[]; doubts: string[]; error?: string;
}
/** 화면 자동 검사 (owner 2026-10-29, ④): GPT looks at the render PC's 점검 시트 (one frame per scene) for text past its box,
 * overlaps, cut faces, blanks, broken letters, a logo or a crowded scene. Its own record, so the run's record never conflicts. */
export interface YpScreenIssue { scene: number; kind: string; issue: string; fix: string }
export interface YpScreenCheck {
  state: "none" | "running" | "done" | "failed"; at: string; model: string;
  /** The run and the preparation (its prepared.at) whose sheets were judged: a newer preparation means an older check. */
  runId: string; sheetsAt: string; scenes: YpScreenIssue[]; note: string; error?: string;
}
/** 카드뉴스 (설계서 2026-10-30): the text it was made from (a copy, so a later change upstream never moves it), the drafts, the one
 * picked, and what 카드 확정 fixed. Drafts of several formats sit side by side; the PD picks one and edits it. */
export interface YpCardSource { kind: "longform" | "short" | "threads" | "none"; title: string; text: string; at: string }
export interface YpCards {
  source: YpCardSource; focus: string; drafts: CardDraft[]; picked: string;
  recommend?: { formats: CardFormatId[]; why: string };
  /** sig = the confirmed card; aiSig = the AI draft it started from, to see how far the PD moved it (정본 다듬기). */
  confirmed?: { at: string; draftId: string; sig: string; aiSig?: string };
  exported?: { at: string; by: string; url: string };
}
/** 롱폼 주제 (owner 2026-10-30, like the 숏폼's): the title formulas the staff AI drew from the 참고 영상 and the 주제 후보 made from
 * them; the PD picks one and fixes the topic. channels = different channels among a formula's videos (3 = 확인된 주제, as in 틈새). */
export interface YpTopicFormula { formula: string; desire: string; refs: { title: string; url: string; channel: string }[]; channels: number }
export interface YpTopicResearch {
  research?: { by: string; model: string; at: string; jobId: string; market?: { query: string; count: number }; formulas: YpTopicFormula[]; topics: YpShortTopicPick[]; notes: string };
}
/** A short fingerprint of a 원고 (FNV-1a over the trimmed text), the same on the server and in the browser. */
export function scriptKey(md: string) {
  let hash = 0x811c9dc5;
  for (const char of md.replace(/\r/g, "").trim()) hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}
export type YpStageData = { plan: YpPlan; outline: YpOutline; make: YpMake; upload: YpUpload; column: YpColumn; shortTopics: YpShortTopics; shortScript: YpShortScript; review2: YpReview2; screenCheck: YpScreenCheck; topicResearch: YpTopicResearch; cards: YpCards };
export interface YpStageRecord<K extends YpStageKind = YpStageKind> { id: string | null; version: number; data: YpStageData[K] }
export type YpStages = { [K in YpStageKind]: YpStageRecord<K> };

const id = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).slice(0, 12);
// 로건 QA 10/30: animation is made at 60 fps (meeting decision; Logan's engine renders 60 fps since 2026-10-29), and each kind marks
// only its own default — both 4K and FHD read 「기본」 before.
export const SPEC_DEFAULT: Record<YpKind, YpOutline["spec"]> = {
  // 로건 QA 10/30: the 러닝타임 was the one field typed again every time — a new longform starts at the usual length.
  live: { runtimeMin: 10, res: "4K (선명 · 기본)", fps: "30fps (기본)", ratio: "16:9 가로 (롱폼 · 기본)" },
  anim: { runtimeMin: 12, res: "FHD 1080p (기본)", fps: "60fps (기본)", ratio: "16:9 가로 (롱폼 · 기본)" },
  short: { runtimeMin: null, res: "720 × 1280", fps: "30fps (기본)", ratio: "9:16 세로" },
  card: { runtimeMin: null, res: "1080 × 1350", fps: "—", ratio: "4:5 세로" },
};
const LONG_RATIOS = ["16:9 가로 (롱폼 · 기본)", "9:16 세로", "1:1 정사각"];
export const SPEC_OPTIONS: Record<YpKind, Record<"res" | "fps" | "ratio", string[]>> = {
  live: { res: ["4K (선명 · 기본)", "FHD 1080p", "QHD 1440p"], fps: ["30fps (기본)", "24fps", "60fps"], ratio: LONG_RATIOS },
  anim: { res: ["FHD 1080p (기본)", "4K (선명)", "QHD 1440p"], fps: ["60fps (기본)", "30fps", "24fps"], ratio: LONG_RATIOS },
  short: { res: ["720 × 1280", "1080 × 1920"], fps: ["30fps (기본)", "60fps"], ratio: ["9:16 세로"] },
  // 카드뉴스 (설계서 2026-10-30): one size, no 구성안 screen reads these.
  card: { res: ["1080 × 1350"], fps: ["—"], ratio: ["4:5 세로"] },
};
/** 로건 QA 10/30: a value saved under an older label (「30fps (기본)」 before 60fps became the 애니 default) shows as its option now
 * (「30fps」), so the list never holds two 「(기본)」. */
export function specOption(kind: YpKind, key: "res" | "fps" | "ratio", saved: string) {
  const options = SPEC_OPTIONS[kind][key], bare = (value: string) => value.replace(/\s*\(.*\)$/, "");
  return options.find(option => option === saved) ?? options.find(option => bare(option) === bare(saved)) ?? saved;
}
// 보낼 곳 (owner decision 2026-10-26: 회사 유튜브는 마이인 자사몰로, 영상마다 UTM을 따로): a MYIN page, or any https address.
export const UTM_DESTS = [["정밀 진단", "https://www.myinlab.co.kr/services/n6"], ["무료 진단", "https://www.myinlab.co.kr/services/free"],
  ["마이인 홈", "https://www.myinlab.co.kr/"], ["직접 입력", ""]] as const;
export const UTM_DEFAULT_URL = UTM_DESTS[0][1];
/** The address the UTM is put on: the video's own, else 정밀 진단. */
export const utmBase = (utm: Pick<YpUpload["utm"], "url">) => /^https:\/\/[^\s]+$/.test(utm.url?.trim() ?? "") ? utm.url!.trim() : UTM_DEFAULT_URL;
/** utm_content: the project code, known before the upload, so the 단축 링크 can be made from the start. */
export const utmCode = (projectId: string) => `yp-${projectId.slice(0, 8)}`;
export const UTM_OPTIONS = {
  cat: [["키", "키"], ["풀링", "풀링"], ["키+풀링", "키+풀링"]],
  camp: [["jindan_report", "jindan_report (기본)"], ["keycontent", "keycontent (키 콘텐츠)"], ["lecture", "lecture (강의)"], ["community", "community (커뮤니티)"]],
} as const;

export function emptyStage<K extends YpStageKind>(kind: K, projectKind: YpKind | null): YpStageData[K] {
  const blank: YpStageData = {
    plan: { titles: [{ id: id(), text: "" }, { id: id(), text: "" }, { id: id(), text: "" }], thumbs: [{ id: id(), mode: "text" }, { id: id(), mode: "text" }],
      opening: "", body: "", closing: "", note: "", extraRefs: [] },
    outline: { spec: { ...SPEC_DEFAULT[projectKind ?? "anim"] }, script: "", versions: [] },
    make: { editDue: "", status: "prep", statusAt: {}, log: [], finals: [], thumbs: {}, aTitle: "", aReason: "" },
    upload: { utm: { cat: "키", dest: "진단", camp: "jindan_report", next: "", short: "" }, srt: null, desc: "", pinned: "", hiddenTags: [], descBy: null, privacy: "private", run: null },
    column: { items: [] },
    shortTopics: { items: [] },
    shortScript: { query: "", refs: [], text: "", hooks: [], insight: "", formula: "", headCopy: "" },
    review2: { state: "none", at: "", model: "", key: "", gates: [], doubts: [] },
    screenCheck: { state: "none", at: "", model: "", runId: "", sheetsAt: "", scenes: [], note: "" },
    topicResearch: {},
    cards: { source: { kind: "none", title: "", text: "", at: "" }, focus: "", drafts: [], picked: "" },
  };
  return blank[kind] as YpStageData[K];
}
/** A stored record's data over the empty shape, so a field added later never reads as undefined. */
export function stageData<K extends YpStageKind>(kind: K, stored: unknown, projectKind: YpKind | null): YpStageData[K] {
  const base = emptyStage(kind, projectKind);
  return stored && typeof stored === "object" ? { ...base, ...(stored as object) } as YpStageData[K] : base;
}

// ── 제작 (S5) ──
/** 업로드 전 급한 수정 (로건 요청 2026-10-30): after the 최종 검토 컨펌, until the video is on YouTube, a new final or a thumbnail file still goes in
 * (the upload sends the newest final); titles, copies and dates stay as confirmed. */
export const lateMakeOk = (stage: string, uploaded: boolean, patch: object) =>
  stage === "upload" && !uploaded && Object.entries(patch).every(([key, value]) => value === undefined || key === "addFinal" || key === "thumb");

// ── 기획안 (S3) ──
// 로건 QA 10/30: only looking at the 「이미지」 tab of a card already written turned it back to empty — either one fills it (the card
// shows the words while it has no image).
export const thumbFilled = (thumb?: YpThumb | null) => Boolean(thumb && ((thumb.mode === "img" && thumb.path) || thumb.copy?.trim() || thumb.screen?.trim()));
/** The one-line reason the 기획안 컨펌 request is not ready, or "" (시안 draftMissing). */
export function draftMissing(plan: YpPlan) {
  for (const [index, name] of [[0, "첫째"], [1, "둘째"]] as const) if (!plan.titles[index]?.text.trim()) return `${name} 줄 제목(${slotOf(index)})을 써 주세요`;
  for (const [index, name] of [[0, "첫 번째"], [1, "두 번째"]] as const) if (!thumbFilled(plan.thumbs[index])) return `${name} 썸네일 후보(${slotOf(index)})를 넣어 주세요`;
  if (!plan.opening.trim()) return "오프닝을 써 주세요";
  if (!plan.body.trim()) return "본론을 써 주세요";
  if (!plan.closing.trim()) return "클로징 · 다음 행동을 써 주세요";
  return "";
}
/** What the 기획안 컨펌 OK fixes: title and thumbnail pairs A · B and C when both rows have something. */
export function confirmPlan(plan: YpPlan, at: string): NonNullable<YpPlan["confirmed"]> {
  const confirmed: NonNullable<YpPlan["confirmed"]> = { at };
  SLOTS.forEach((slot, index) => {
    const title = plan.titles[index]?.text.trim() ?? "";
    const thumb = thumbFilled(plan.thumbs[index]) ? plan.thumbs[index] : null;
    if (title || thumb) confirmed[slot] = { title, thumb };
  });
  return confirmed;
}
/** Plan fields → the keys the approver ticks in 수정 요청 (GATE_FIELDS.draft). */
export const PLAN_FIELD_KEY: Record<"titles" | "thumbs" | "opening" | "body" | "closing" | "note" | "extraRefs", string> = {
  titles: "draft.tt", thumbs: "draft.tt", opening: "draft.opening", body: "draft.body", closing: "draft.closing", note: "draft.note", extraRefs: "draft.note",
};

// ── 구성안 (S4) ──
export const CHARS_PER_MINUTE_V1 = 350;
/** Spoken letters (no spaces, headings, tables or images) — the 예상 길이 count (3차 결정 12). */
export function scriptChars(markdown: string) {
  // The editor writes [ ] as \[ \] — the backslashes are not letters anyone says.
  return narrationFromMarkdown(withoutShots(markdown).replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\\(?=[[\]])/g, "")).replace(/\s/g, "").length;
}
/**
 * 실사 촬영 콘티 (로건 QA 10/30): from [샷] · [B롤] · [인서트] to the end of its line is a shooting note, not something said; what comes
 * before it on the line is still said (the editor puts a marker after the sentence the cursor is in). The editor may keep the bracket
 * escaped (\[B롤]), so both read the same.
 */
export type ShotKind = "샷" | "B롤" | "인서트";
const SHOT = /\\?\[(샷|B롤|인서트)\\?\]\s*(.*)$/;
export const shotLine = (line: string) => {
  const match = line.match(SHOT);
  return match ? { kind: match[1] as ShotKind, text: match[2].trim(), before: line.slice(0, match.index).replace(/^\s*(?:[-*]\s+)?/, "").trim() } : null;
};
export const withoutShots = (markdown: string) => markdown.split("\n").map(line => shotLine(line)?.before ?? line).join("\n");
/** The shooting notes in order, each under the spoken paragraph it follows (0 = before the first). */
export function shotList(markdown: string) {
  const rows: { n: number; line: string; kind: ShotKind; text: string }[] = [];
  let n = 0, last = "";
  for (const raw of markdown.replace(/\r/g, "").split("\n")) {
    const line = raw.trim().replace(/\\(?=[[\]])/g, "");
    if (!line || /^(#|!\[|---|\|)/.test(line)) continue;
    const shot = shotLine(line);
    if (!shot || shot.before) { n++; last = shot ? shot.before : line; }
    if (shot) rows.push({ n, line: last, kind: shot.kind, text: shot.text });
  }
  return rows;
}
export function runtimeError(runtime: number | null) {
  if (runtime === null) return "";
  return Number.isInteger(runtime) && runtime >= 1 && runtime <= 120 ? "" : "러닝타임은 1 ~ 120분 사이 숫자로 써 주세요";
}
/** 예상 길이 and whether it is within ±20% of the runtime. */
/** 「3분 17초」: a length in seconds as people read it. */
export const minSec = (seconds: number) => { const s = Math.round(seconds); return s >= 60 ? `${Math.floor(s / 60)}분${s % 60 ? ` ${s % 60}초` : ""}` : `${s}초`; };
/**
 * The 원고's length against the 러닝타임: by its letters, or by the made voice once there is one (`voiceSec`). 로건 QA 10/30: ±20%
 * called 13분 6초 「맞아요」 for 12분 and rounded a 9분 35초 gap to 10분 — now within 30초 (or 5%) passes and the gap is exact.
 */
export function lengthEstimate(markdown: string, runtime: number | null, voiceSec?: number | null) {
  const chars = scriptChars(markdown);
  const minutes = chars / CHARS_PER_MINUTE_V1;
  const label = !chars ? "—" : minutes < 1 ? `약 ${Math.round(minutes * 60)}초` : `약 ${Math.floor(minutes)}분${Math.round((minutes % 1) * 60) >= 30 ? " 30초" : ""}`;
  if (!chars || !runtime || runtimeError(runtime)) return { chars, label, verdict: null as null | { ok: boolean; text: string } };
  const gap = (voiceSec ?? minutes * 60) - runtime * 60, what = voiceSec ? "실제 음성이 " : "";
  return { chars, label, verdict: Math.abs(gap) <= Math.max(30, runtime * 3) ? { ok: true, text: `${what}정한 러닝타임(${runtime}분)에 맞아요` }
    : { ok: false, text: `${what}정한 러닝타임(${runtime}분)보다 ${minSec(Math.abs(gap))} ${gap < 0 ? "짧아요" : "길어요"} · 내용이 필요하면 러닝타임을 고쳐요` } };
}
/** 원고 문단 번호 · 예상 시각 (로건 QA 10/30): each spoken paragraph's start, spread over the made voice's length when there is one. */
export function paragraphTimes(spoken: string[], voiceSec?: number | null) {
  const sizes = spoken.map(text => text.replace(/\s/g, "").length), total = sizes.reduce((sum, size) => sum + size, 0);
  const length = voiceSec || total / CHARS_PER_MINUTE_V1 * 60;
  let before = 0;
  return spoken.map((text, index) => { const at = total ? before / total * length : 0; before += sizes[index]; return { n: index + 1, at, text }; });
}
/** 기획안 writes →, the 원고 came with -> (로건 QA 10/30): one arrow everywhere. */
export const oneArrow = (text: string) => text.replace(/->/g, "→");
export function outlineMissing(outline: YpOutline) {
  if (outline.spec.runtimeMin === null) return "러닝타임을 정해 주세요";
  const error = runtimeError(outline.spec.runtimeMin);
  if (error) return error;
  if (!scriptChars(outline.script)) return "원고를 써 주세요";
  return "";
}
/** The 기획안 영상 흐름 as the first 원고 (시안 scriptFromDraft). */
export const scriptFromPlan = (plan: YpPlan) => `### 오프닝 (첫 30초)\n\n${plan.opening}\n\n### 본론\n\n${plan.body}\n\n### 클로징 · 다음 행동\n\n${plan.closing}\n`;
export const MAX_SCRIPT_VERSIONS = 30;
/** A new current 원고, kept as a version (the oldest drop off after 30). */
export function withScriptVersion(outline: YpOutline, md: string, by: string, at: string, why: YpScriptVersion["why"], model?: string): YpOutline {
  const v = (outline.versions.at(-1)?.v ?? 0) + 1;
  return { ...outline, script: md, versions: [...outline.versions, { v, at, by, md, why, ...(model ? { model } : {}) }].slice(-MAX_SCRIPT_VERSIONS) };
}

// ── 제작 (S5) ──
export const MAKE_STEPS: Record<YpKind, [YpMakeStatus, string][]> = {
  live: [["prep", "준비"], ["shoot", "촬영"], ["edit", "편집 중"], ["done", "완료"]],
  anim: [["prep", "준비"], ["edit", "편집"], ["done", "완료"]],
  short: [["prep", "준비"], ["done", "완료"]],
  card: [["prep", "준비"], ["done", "완료"]],
};
/** The title and thumbnail copy a slot goes out with: the confirmed pair, or what 제작 changed on purpose (empty keeps the confirmed one). */
export function finalPair(plan: Pick<YpPlan, "confirmed">, make: Pick<YpMake, "aTitle" | "aReason" | "edits">, slot: YpSlot) {
  const base = plan.confirmed?.[slot];
  if (!base) return null;
  const edit = make.edits?.[slot] ?? (slot === "A" && make.aTitle ? { title: make.aTitle, copy: "", reason: make.aReason } : null);
  const title = edit?.title || base.title;
  const copy = edit?.copy || base.thumb?.copy || "";
  const changed = title !== base.title || copy !== (base.thumb?.copy ?? "");
  return { title, copy, thumb: base.thumb ? { ...base.thumb, copy } : copy ? { id: slot, mode: "text" as const, copy } : null, changed, reason: changed ? edit?.reason ?? "" : "" };
}
export function thumbsMissing(make: YpMake) {
  for (const slot of ["A", "B"] as const) if (!make.thumbs[slot]) return `${slot} 최종 썸네일을 올려 주세요`;
  return "";
}

// ── 업로드 (S7) ──
export function utmUrl(utm: YpUpload["utm"], code?: string) {
  const base = utmBase(utm);
  return `${base}${base.includes("?") ? "&" : "?"}utm_source=youtube&utm_medium=organic&utm_campaign=${encodeURIComponent(utm.camp)}&utm_content=${code ?? "[올린 뒤 채워짐]"}`;
}
const isYoutubeLink = (link: string) => /^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(link.trim());
/** The 단축 링크 when it is one: a YouTube address pasted there went out as the 진단 링크 (로건 피드백 10/26-10). */
const shortLink = (utm: Pick<YpUpload["utm"], "short">) => utm.short.trim() && !isYoutubeLink(utm.short) ? utm.short.trim() : "";
export const shortLinkProblem = (short: string) => isYoutubeLink(short) ? "단축 링크 칸에 유튜브 주소가 들어 있어요. 위 UTM 주소로 만든 단축 링크를 넣어요." : "";
/** The 진단 링크 the description and pinned comment carry: the 단축 링크, else the UTM address. */
export const diagnosisLink = (utm: YpUpload["utm"], code?: string) => shortLink(utm) || utmUrl(utm, code);
export function pinnedDraft(utm: YpUpload["utm"]) {
  return `[질문 한 줄]\n⬇️ [진단 CTA 한 줄]\n${shortLink(utm) || "[진단 단축 링크]"}\n${utm.nextNote?.trim() || "이어서 보면 좋을 영상 보러가기"}\n${utm.next || "[이어서 볼 영상 링크 — 1번에 붙여넣기]"}`;
}
/** The 이어서 볼 영상 and 다른 유입처 links of 1번, each with its line, that the description must carry. */
export const linkRows = (utm: YpUpload["utm"]) => [{ note: utm.nextNote?.trim() || "이어서 보면 좋을 영상", url: utm.next.trim() }, ...(utm.others ?? []).map(row => ({ note: row.note.trim(), url: row.url.trim() }))]
  .filter(row => /^https?:\/\/\S+$/.test(row.url));
/** 예약 (로건 요청 10/30): YouTube takes a publish time only while it is still ahead; 10 minutes leave room for the upload itself. */
export const publishAtProblem = (publishAt: string | null | undefined, now = Date.now()) =>
  publishAt && !(Date.parse(publishAt) >= now + 10 * 60_000) ? "예약 시각이 지났거나 10분도 안 남았어요. 5. 공개 범위에서 시각을 다시 정해 주세요." : "";
/** The links of 1번 the description does not have yet. */
export const linksMissing = (desc: string, utm: YpUpload["utm"]) => linkRows(utm).filter(row => !desc.includes(row.url));
/** Puts the missing links (line, then address) at the end of the ⬇️ 진단 CTA part, so they always reach YouTube (로건 요청 10/30). */
export function withLinks(desc: string, utm: YpUpload["utm"]) {
  const missing = linksMissing(desc, utm);
  if (!missing.length) return desc;
  const lines = desc.split("\n"), block = missing.flatMap(row => row.note ? [row.note, row.url] : [row.url]);
  const cta = lines.findIndex(line => line.trim().startsWith("⬇️"));
  const tags = lines.findIndex(line => line.trim() === "[히든 태그]");
  const end = cta >= 0 ? lines.findIndex((line, i) => i > cta && line.trim().startsWith("-----")) : tags > 0 && lines[tags - 1].trim().startsWith("-----") ? tags - 1 : -1;
  if (end < 0) return [...lines, ...block].join("\n");
  return [...lines.slice(0, end), ...block, ...lines.slice(end)].join("\n");
}
/** Lines under a [구역] heading up to the next ----- (시안 secOf). */
function section(text: string, key: string) {
  const at = text.indexOf(key);
  if (at < 0) return null;
  const rest = text.slice(at + key.length).split("\n");
  const lines: string[] = [];
  for (const line of rest.slice(1)) { if (line.trim().startsWith("-----")) break; if (line.trim()) lines.push(line.trim()); }
  return lines;
}
/** The 7 automatic checks under the description (시안 descChecks). Advisory only: they never block the upload. */
/** The 직접 쓰기 starting layout of the description: section labels and dividers only. */
// 「유튜브 발행 키트 만드는 절차」 정본 §1 (v1.3, 2026-10-26): 소개 1~2줄 → 해시태그 → 진단 CTA → 타임라인 → 요약 → 출처 → 히든 태그.
export const DESC_TEMPLATE = "\n-----\n#\n-----\n⬇️ \n-----\n[타임라인]\n00:00 \n-----\n[설명문 본문]\n\n-----\n[인용 및 출처]\n- \n-----\n[히든 태그]\n";
/** A description counts as written once it has something beyond that layout (usability QA 2026-10-25: the bare layout passed). */
export const descWritten = (text: string) => text.split("\n").some(line => { const t = line.trim(); return Boolean(t) && !/^(#|-+|⬇️|00:00|\[[^\]]+\])$/.test(t); });
const SOURCE_MARK = /미제공|불확실|확인 필요/;
export function descChecks(text: string, upload: Pick<YpUpload, "srt" | "utm">) {
  // 정본 §1: the description opens with a 1–2 line introduction (what shows before 더보기), then the hashtags and the sections.
  const first = text.split("\n").map(line => line.trim()).find(Boolean) ?? "";
  const intro = Boolean(first) && !/^(#|-{3,}|⬇️|\[)/.test(first);
  const keys = [text.search(/^\s*#\S/m), ...["⬇️", "[타임라인]", "[설명문 본문]", "[인용 및 출처]", "[히든 태그]"].map(key => text.indexOf(key))];
  const order = intro && keys.every(at => at >= 0) && keys.every((at, i) => !i || at > keys[i - 1]) && text.lastIndexOf("-----") < keys[5];
  const timeline = section(text, "[타임라인]") ?? [];
  const timelineOk = timeline.length >= 5 && timeline.length <= 8 && /^00:00\b/.test(timeline[0]) && timeline.every(line => line.replace(/^\S+\s*/, "").length <= 24);
  const tags = hiddenTagsOf(text);
  const body = section(text, "[설명문 본문]") ?? [];
  const cta = text.split("\n").find(line => line.trim().startsWith("⬇️")) ?? "";
  const links = text.match(/https?:\/\/\S+/g) ?? [];
  const short = shortLink(upload.utm);
  const base = utmBase(upload.utm);
  const known = linkRows(upload.utm).map(row => row.url);
  const fake = links.filter(link => !link.startsWith(base) && !(short && link.startsWith(short)) && !known.some(url => link.startsWith(url)));
  // 로건 피드백 10/26-11: the link under the ⬇️ 진단 CTA must be the UTM address or its short link — a youtu.be there passed before.
  const lines = text.split("\n");
  const ctaAt = lines.findIndex(line => line.trim().startsWith("⬇️"));
  const underCta = ctaAt >= 0 ? lines.slice(ctaAt, ctaAt + 3).join("\n") : "";
  const diagnosisOk = Boolean(short && underCta.includes(short)) || (underCta.match(/https?:\/\/\S+/)?.[0] ?? "").startsWith(base);
  const sources = (section(text, "[인용 및 출처]") ?? []).filter(line => line.startsWith("-"));
  return [
    { ok: order, text: order ? "소개로 시작하고 구역 순서가 맞고 히든 태그가 맨 마지막이에요" : "소개 1~2줄로 시작하지 않거나, 구역 순서가 다르거나, 히든 태그가 맨 뒤가 아니에요" },
    { ok: timelineOk, text: timelineOk ? "타임라인: 00:00 시작 · 5~8줄 · 줄마다 20자 안팎" : "타임라인: 00:00 시작 · 5~8줄 · 줄마다 20자 안팎인지 봐 주세요" },
    { ok: Boolean(upload.srt), text: upload.srt ? "타임라인 시간이 자막 기준이에요" : "자막이 없어 타임라인 시간이 자리표시예요" },
    { ok: body.length >= 1 && body.length <= 3, text: body.length >= 1 && body.length <= 3 ? "요약이 3줄 이내예요" : `요약이 ${body.length}줄이에요 (1~3줄)` },
    { ok: cta.length <= 40 && !(/무료/.test(cta) && /진단/.test(cta)), text: cta.length <= 40 && !(/무료/.test(cta) && /진단/.test(cta)) ? "진단 CTA가 짧고 '무료'가 없어요" : "진단 CTA가 길거나 '무료'가 붙었어요 (진단은 유료)" },
    !links.length ? { ok: true, text: "링크는 자리표시예요 (지어낸 링크 없음)" }
      : !diagnosisOk ? { ok: false, text: "진단 CTA 아래 링크가 UTM 주소(또는 그 단축 링크)가 아니에요" }
      : { ok: !fake.length, text: fake.length ? `확인 안 된 링크가 있어요: ${fake[0]}` : "진단 링크가 UTM 주소예요" },
    // 정본 §1-2 (v1.4, 2026-10-31): only what is known; 「미제공」「불확실」 never reach the viewer — unchecked sources leave the description.
    sources.some(line => SOURCE_MARK.test(line)) ? { ok: false, text: "출처에 「미제공」「불확실」 같은 말이 있어요. 모르는 칸은 빼고, 확인 못 한 출처는 지워 주세요" }
      : { ok: sources.every(line => line.includes("/")), text: sources.every(line => line.includes("/")) ? "출처가 「내용 / 종류 / 기관」 형식이에요" : "출처를 「내용 / 종류 / 기관 (시점)」 형식으로 써 주세요" },
    { ok: tags.length >= 6 && tags.length <= 12, text: tags.length >= 6 && tags.length <= 12 ? `히든 태그 ${tags.length}개예요` : `히든 태그가 ${tags.length}개예요 (6~12개)` },
  ];
}
/** The hidden tags at the end of the description, for the YouTube tags field. */
export const hiddenTagsOf = (text: string) => (section(text, "[히든 태그]") ?? []).join(",").split(",").map(tag => tag.trim().replace(/^#/, "")).filter(Boolean);
