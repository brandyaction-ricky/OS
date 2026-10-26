// 유튜브 공정 v1 stage records (지시서 6-1 · 6-2): 기획안 · 구성안 · 제작 · 업로드 (+ SEO 칼럼, 2026-10-25), one child record each under the project.
// Rules here are shared by the API, the screens and the demo store.
import type { YpKind, YpRef } from "./project";
import { narrationFromMarkdown } from "../youtube-narration-document.ts";

export type YpStageKind = "plan" | "outline" | "make" | "upload" | "column";
export const STAGE_RECORD: Record<YpStageKind, { recordType: "content_package" | "content_script"; key: "packageKind" | "scriptKind"; value: string; title: string }> = {
  plan: { recordType: "content_package", key: "packageKind", value: "yp_plan", title: "기획안" },
  outline: { recordType: "content_script", key: "scriptKind", value: "yp_outline", title: "구성안" },
  make: { recordType: "content_package", key: "packageKind", value: "yp_make", title: "제작" },
  upload: { recordType: "content_package", key: "packageKind", value: "yp_upload", title: "업로드" },
  column: { recordType: "content_package", key: "packageKind", value: "yp_column", title: "SEO 칼럼" },
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
export interface YpPatterns { titlePatterns: YpPattern[]; copyPatterns: { main: YpPattern[]; sub: YpPattern[] }; market?: { query: string; count: number } }
export interface YpRedo extends Partial<YpPatterns> {
  at: string; by: string; model: string; jobId: string; market?: { query: string; count: number };
  /** One-sentence formulas from the first 다시 뽑기 runs (before the patterns, 2026-10-25). */
  formula?: string; titleBasis?: string; copyFormula?: string; copyBasis?: string;
  titles: YpRedoPick[]; copies: YpRedoPick[];
}
export interface YpRedoPick { text: string; sub?: string; hook: string; pattern?: number; why: string }
export interface YpUpload {
  utm: { cat: string; dest: string; camp: string; next: string; short: string };
  srt: { path: string; name: string } | null;
  desc: string; pinned: string; hiddenTags: string[];
  descBy: { userId: string; name: string; model: string; jobId: string; at: string; draft: string; title?: string } | null;
  /** A 숏폼's YouTube title (2026-10-25); a longform goes up with its confirmed A title instead. */
  title?: string;
  /** The AI's pinned comment when a person had already edited the description (shown beside it, not applied). */
  pinnedDraft?: string;
  /** The same AI pass's copy for other channels and the upload checklist (the earlier 유튜브 관리 kit). */
  extras?: { kakao: string; cafe: string; post: string; checklist: string[]; checked: number[] };
  privacy: "private" | "unlisted";
  run: { at: string; by: string; status: "done" | "failed"; videoId?: string; videoUrl?: string; finalV?: number; thumbnail?: "ok" | "fail" | "skip"; error?: string } | null;
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
export type YpStageData = { plan: YpPlan; outline: YpOutline; make: YpMake; upload: YpUpload; column: YpColumn };
export interface YpStageRecord<K extends YpStageKind = YpStageKind> { id: string | null; version: number; data: YpStageData[K] }
export type YpStages = { [K in YpStageKind]: YpStageRecord<K> };

const id = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).slice(0, 12);
export const SPEC_DEFAULT: Record<YpKind, YpOutline["spec"]> = {
  live: { runtimeMin: null, res: "4K (선명 · 기본)", fps: "30fps (기본)", ratio: "16:9 가로 (롱폼 · 기본)" },
  anim: { runtimeMin: null, res: "FHD 1080p (기본)", fps: "30fps (기본)", ratio: "16:9 가로 (롱폼 · 기본)" },
  short: { runtimeMin: null, res: "720 × 1280", fps: "30fps (기본)", ratio: "9:16 세로" },
};
export const SPEC_OPTIONS = {
  res: ["4K (선명 · 기본)", "FHD 1080p (기본)", "QHD 1440p"],
  fps: ["30fps (기본)", "24fps", "60fps"],
  ratio: ["16:9 가로 (롱폼 · 기본)", "9:16 세로", "1:1 정사각"],
};
export const UTM_BASE = "https://www.brandyaction.com/classes/294620";
export const UTM_OPTIONS = {
  cat: [["키", "키"], ["풀링", "풀링"], ["키+풀링", "키+풀링"]],
  dest: [["진단", "진단"], ["진단+키", "진단+키"], ["진단+키+PPT", "진단+키+PPT"]],
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
  };
  return blank[kind] as YpStageData[K];
}
/** A stored record's data over the empty shape, so a field added later never reads as undefined. */
export function stageData<K extends YpStageKind>(kind: K, stored: unknown, projectKind: YpKind | null): YpStageData[K] {
  const base = emptyStage(kind, projectKind);
  return stored && typeof stored === "object" ? { ...base, ...(stored as object) } as YpStageData[K] : base;
}

// ── 기획안 (S3) ──
export const thumbFilled = (thumb?: YpThumb | null) => Boolean(thumb && (thumb.mode === "img" ? thumb.path : (thumb.copy?.trim() || thumb.screen?.trim())));
/** The one-line reason the 기획안 컨펌 request is not ready, or "" (시안 draftMissing). */
export function draftMissing(plan: YpPlan) {
  for (const [index, name] of [[0, "첫째"], [1, "둘째"]] as const) if (!plan.titles[index]?.text.trim()) return `${name} 줄 제목(${slotOf(index)})을 써 주세요`;
  for (const [index, name] of [[0, "첫 번째"], [1, "두 번째"]] as const) if (!thumbFilled(plan.thumbs[index])) return `${name} 썸네일 시안(${slotOf(index)})을 넣어 주세요`;
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
  return narrationFromMarkdown(markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, "")).replace(/\s/g, "").length;
}
export function runtimeError(runtime: number | null) {
  if (runtime === null) return "";
  return Number.isInteger(runtime) && runtime >= 1 && runtime <= 120 ? "" : "러닝타임은 1 ~ 120분 사이 숫자로 써 주세요";
}
/** 예상 길이 and whether it is within ±20% of the runtime. */
export function lengthEstimate(markdown: string, runtime: number | null) {
  const chars = scriptChars(markdown);
  const minutes = chars / CHARS_PER_MINUTE_V1;
  const label = !chars ? "—" : minutes < 1 ? `약 ${Math.round(minutes * 60)}초` : `약 ${Math.floor(minutes)}분${Math.round((minutes % 1) * 60) >= 30 ? " 30초" : ""}`;
  if (!chars || !runtime || runtimeError(runtime)) return { chars, label, verdict: null as null | { ok: boolean; text: string } };
  const diff = (minutes - runtime) / runtime;
  return { chars, label, verdict: Math.abs(diff) <= 0.2 ? { ok: true, text: `정한 러닝타임(${runtime}분)에 맞아요` }
    : { ok: false, text: `정한 러닝타임(${runtime}분)보다 약 ${Math.max(1, Math.round(Math.abs(minutes - runtime)))}분 ${diff < 0 ? "짧아요" : "길어요"} · 내용이 필요하면 러닝타임을 고쳐요` } };
}
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
export function utmUrl(utm: YpUpload["utm"], videoId?: string) {
  return `${UTM_BASE}?utm_source=youtube&utm_medium=organic&utm_campaign=${utm.camp}&utm_content=${videoId ?? "[올린 뒤 채워짐]"}&utm_term={query}`;
}
export function pinnedDraft(utm: YpUpload["utm"]) {
  return `⬇️ [진단 CTA 한 줄]\n${utm.short || "[진단 단축 링크]"}\n이어서 보면 좋을 영상 보러가기\n${utm.next || "[이어서 볼 영상 링크 — 1번에 붙여넣기]"}`;
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
export const DESC_TEMPLATE = "#\n-----\n⬇️ \n-----\n[타임라인]\n00:00 \n-----\n[설명문 본문]\n\n-----\n[인용 및 출처]\n- \n-----\n[히든 태그]\n";
/** A description counts as written once it has something beyond that layout (usability QA 2026-10-25: the bare layout passed). */
export const descWritten = (text: string) => text.split("\n").some(line => { const t = line.trim(); return Boolean(t) && !/^(#|-+|⬇️|00:00|\[[^\]]+\])$/.test(t); });
export function descChecks(text: string, upload: Pick<YpUpload, "srt" | "utm">) {
  const keys = ["⬇️", "[타임라인]", "[설명문 본문]", "[인용 및 출처]", "[히든 태그]"].map(key => text.indexOf(key));
  const order = /^\s*#/.test(text) && keys.every(at => at >= 0) && keys.every((at, i) => !i || at > keys[i - 1]) && text.lastIndexOf("-----") < keys[4];
  const timeline = section(text, "[타임라인]") ?? [];
  const timelineOk = timeline.length >= 3 && /^00:00\b/.test(timeline[0]) && timeline.every(line => line.replace(/^\S+\s*/, "").length <= 24);
  const body = section(text, "[설명문 본문]") ?? [];
  const cta = text.split("\n").find(line => line.trim().startsWith("⬇️")) ?? "";
  const links = text.match(/https?:\/\/\S+/g) ?? [];
  const fake = links.filter(link => !link.startsWith(UTM_BASE) && !(upload.utm.short && link.startsWith(upload.utm.short)) && !(upload.utm.next && link.startsWith(upload.utm.next)));
  const sources = (section(text, "[인용 및 출처]") ?? []).filter(line => line.startsWith("-"));
  return [
    { ok: order, text: order ? "구역 순서가 맞고 히든 태그가 맨 마지막이에요" : "구역 순서가 다르거나 히든 태그가 맨 뒤가 아니에요" },
    { ok: timelineOk, text: timelineOk ? "타임라인: 00:00 시작 · 3줄 이상 · 줄마다 20자 안팎" : "타임라인: 00:00 시작 · 3줄 이상 · 줄마다 20자 안팎인지 봐 주세요" },
    { ok: Boolean(upload.srt), text: upload.srt ? "타임라인 시간이 자막 기준이에요" : "자막이 없어 타임라인 시간이 자리표시예요" },
    { ok: body.length === 5, text: body.length === 5 ? "본문이 5줄이에요" : `본문이 ${body.length}줄이에요 (5줄)` },
    { ok: cta.length <= 40 && !(/무료/.test(cta) && /진단/.test(cta)), text: cta.length <= 40 && !(/무료/.test(cta) && /진단/.test(cta)) ? "진단 CTA가 짧고 '무료'가 없어요" : "진단 CTA가 길거나 '무료'가 붙었어요 (진단은 유료)" },
    { ok: !fake.length, text: fake.length ? `확인 안 된 링크가 있어요: ${fake[0]}` : links.length ? "링크가 UTM 주소예요" : "링크는 자리표시예요 (지어낸 링크 없음)" },
    { ok: sources.every(line => line.includes("/") && (/불확실|확인 필요/.test(line) || /\(.*\d/.test(line))), text: sources.every(line => line.includes("/") && (/불확실|확인 필요/.test(line) || /\(.*\d/.test(line))) ? "출처 형식 · 확인 안 된 것에 '불확실' 표시" : "출처에 기준 시점이 없거나 '불확실' 표시가 빠졌어요" },
  ];
}
/** The hidden tags at the end of the description, for the YouTube tags field. */
export const hiddenTagsOf = (text: string) => (section(text, "[히든 태그]") ?? []).join(",").split(",").map(tag => tag.trim().replace(/^#/, "")).filter(Boolean);
