// 카드뉴스 포맷 목록 (설계서 2026-10-30 §2): what each format is made of — slide kinds, how many, and the letters each field may
// hold. The screens, the AI job and the server check all read this one list; the 카드뉴스 정본 says how to write, not these numbers.
// Limits count letters with spaces; they start from the font size and the 920px text width and are tuned while the 정본 is ground.

export const CARD_SIZE = { width: 1080, height: 1350 } as const;
export const CARD_MAX_SLIDES = 10;

export type CardFormatId = "list" | "myth" | "quote";
export type CardSlideType = "cover" | "item" | "summary" | "pair" | "line" | "end";
export interface CardField { key: string; label: string; max: number; optional?: boolean }
export interface CardSlideSpec { type: CardSlideType; label: string; min: number; max: number; fields: CardField[] }
export interface CardFormat { id: CardFormatId; name: string; when: string; slides: CardSlideSpec[] }

const cover: CardSlideSpec = { type: "cover", label: "표지", min: 1, max: 1, fields: [{ key: "head", label: "헤드 카피", max: 22 }, { key: "sub", label: "서브", max: 30, optional: true }] };
const end: CardSlideSpec = { type: "end", label: "마무리", min: 1, max: 1, fields: [{ key: "line", label: "마무리 문장", max: 30 }, { key: "action", label: "다음 행동", max: 14 }] };

export const CARD_FORMATS: Record<CardFormatId, CardFormat> = {
  list: { id: "list", name: "정리형", when: "방법 · 신호 · 이유를 나열할 때 (롱폼 원고에 잘 맞아요)", slides: [cover,
    { type: "item", label: "항목", min: 3, max: 7, fields: [{ key: "title", label: "소제목", max: 16 }, { key: "body", label: "설명", max: 60 }] },
    { type: "summary", label: "정리", min: 1, max: 1, fields: [{ key: "line", label: "한 줄 정리", max: 24 }] }, end] },
  myth: { id: "myth", name: "오해와 진실형", when: "흔한 생각을 뒤집을 때 (저장 · 공유가 잘 돼요)", slides: [cover,
    { type: "pair", label: "오해와 진실", min: 3, max: 5, fields: [{ key: "myth", label: "흔한 생각", max: 28 }, { key: "fact", label: "실제", max: 50 }, { key: "basis", label: "근거", max: 40, optional: true }] },
    { type: "summary", label: "정리", min: 1, max: 1, fields: [{ key: "line", label: "한 줄 정리", max: 24 }] }, end] },
  quote: { id: "quote", name: "한 문장형", when: "통찰을 한 줄씩 (스레드 글 · 숏폼 대본에 잘 맞아요)", slides: [cover,
    { type: "line", label: "문장", min: 4, max: 8, fields: [{ key: "text", label: "문장", max: 45 }, { key: "note", label: "덧말", max: 30, optional: true }] }, end] },
};
export const CARD_FORMAT_IDS = Object.keys(CARD_FORMATS) as CardFormatId[];
export const isCardFormat = (value: unknown): value is CardFormatId => typeof value === "string" && value in CARD_FORMATS;

export interface CardSlide { type: CardSlideType; fields: Record<string, string> }
export interface CardDraft {
  id: string; format: CardFormatId; slides: CardSlide[]; caption: string; hashtags: string[]; at: string; by: string;
  /** Who drafted it: a staff member's own AI or the company GPT, and under which 카드뉴스 정본 version (for the 정본 다듬기 comparison). */
  /** sig: cardSignature of the draft as the AI handed it in, so 카드 확정 can tell how far the PD changed it. */
  ai?: { by: string; model: string; at: string; jobId: string; canon: string; sig: string; why?: string };
}

export const slideSpec = (format: CardFormatId, type: CardSlideType) => CARD_FORMATS[format].slides.find(spec => spec.type === type);
const blank = (spec: CardSlideSpec): CardSlide => ({ type: spec.type, fields: Object.fromEntries(spec.fields.map(field => [field.key, ""])) });
/** A new draft with each slide kind at its fewest. */
export function emptyCardDraft(format: CardFormatId, id: string, by: string, at: string): CardDraft {
  return { id, format, slides: CARD_FORMATS[format].slides.flatMap(spec => Array.from({ length: spec.min }, () => blank(spec))), caption: "", hashtags: [], at, by };
}
/** One more body slide after `index` (or the last of its kind), when the format allows it. */
export function addCardSlide(draft: CardDraft, type: CardSlideType): CardDraft {
  const spec = slideSpec(draft.format, type);
  const count = draft.slides.filter(slide => slide.type === type).length;
  if (!spec || count >= spec.max || draft.slides.length >= CARD_MAX_SLIDES) return draft;
  const last = draft.slides.map(slide => slide.type).lastIndexOf(type);
  return { ...draft, slides: [...draft.slides.slice(0, last + 1), blank(spec), ...draft.slides.slice(last + 1)] };
}
export function removeCardSlide(draft: CardDraft, index: number): CardDraft {
  const slide = draft.slides[index];
  const spec = slide && slideSpec(draft.format, slide.type);
  if (!spec || draft.slides.filter(row => row.type === slide.type).length <= spec.min) return draft;
  return { ...draft, slides: draft.slides.filter((_, at) => at !== index) };
}

/** Reorder body cards without moving the cover, summary or ending outside their format. */
export function moveCardSlide(draft: CardDraft, from: number, to: number): CardDraft {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from === to || !draft.slides[from] || !draft.slides[to]) return draft;
  const slides = [...draft.slides];
  slides.splice(to, 0, slides.splice(from, 1)[0]);
  const order = CARD_FORMATS[draft.format].slides.map(spec => spec.type);
  if (slides.some((row, at) => at > 0 && order.indexOf(row.type) < order.indexOf(slides[at - 1].type))) return draft;
  return { ...draft, slides };
}

/** Parsing is for storage only: never replace the text in an input while someone is typing Korean. */
export const parseCardHashtags = (text: string) => [...new Set(text.split(/[\s,#]+/u).map(tag => tag.trim()).filter(Boolean))].slice(0, 30);

const letters = (value: string) => [...value].length;
// Owner rules carried into every format: the 진단 is paid (발행 키트 정본 · 2026-10-26), and '여러분' is not our voice (말투 정본).
const BANNED: [RegExp, string][] = [[/무료\s*(진단|검사)/, "진단은 유료예요 — ‘무료 진단’이라고 쓰지 않아요"], [/여러분/, "‘여러분’은 쓰지 않아요 (말투 정본)"]];
const HASHTAGS = { min: 3, max: 5 };
export const CAPTION_MAX = 2200;

/**
 * What stops 카드 확정 (blocking: a missing or over-long field, a slide count outside the format) and what is only pointed out
 * (warnings: banned words, numbers to source, a repeated line, the hashtag count). The same on the server and in the screen.
 */
export function cardProblems(draft: Pick<CardDraft, "format" | "slides" | "caption" | "hashtags">) {
  const blocking: string[] = [], warnings: string[] = [];
  const format = CARD_FORMATS[draft.format];
  if (!format) return { blocking: ["포맷을 골라 주세요"], warnings };
  if (draft.slides.length > CARD_MAX_SLIDES) blocking.push(`카드는 ${CARD_MAX_SLIDES}장까지예요`);
  for (const spec of format.slides) {
    const count = draft.slides.filter(slide => slide.type === spec.type).length;
    if (count < spec.min || count > spec.max) blocking.push(spec.min === spec.max ? `${spec.label} 장이 ${spec.min}장 있어야 해요` : `${spec.label}은 ${spec.min}~${spec.max}장이에요 (지금 ${count}장)`);
  }
  const order = format.slides.map(spec => spec.type);
  if (draft.slides.some((slide, index) => index && order.indexOf(slide.type) < order.indexOf(draft.slides[index - 1].type))) blocking.push("카드 순서가 포맷과 달라요");
  const seen = new Map<string, number>();
  draft.slides.forEach((slide, index) => {
    const spec = slideSpec(draft.format, slide.type);
    if (!spec) { blocking.push(`${index + 1}장은 이 포맷에 없는 카드예요`); return; }
    for (const field of spec.fields) {
      const value = (slide.fields[field.key] ?? "").trim();
      if (!value && !field.optional) blocking.push(`${index + 1}장 ${field.label}을 써 주세요`);
      if (letters(value) > field.max) blocking.push(`${index + 1}장 ${field.label}이 ${letters(value) - field.max}자 넘쳐요 (${field.max}자까지)`);
      if (value.length >= 8) { if (seen.has(value)) warnings.push(`${seen.get(value)! + 1}장과 ${index + 1}장에 같은 문장이 있어요`); else seen.set(value, index); }
    }
  });
  const all = [...draft.slides.flatMap(slide => Object.values(slide.fields)), draft.caption].join("\n");
  for (const [pattern, message] of BANNED) if (pattern.test(all)) warnings.push(message);
  if (/\d+(\.\d+)?\s*(%|퍼센트|배|명 중)/.test(all) && !/출처|자료|조사|연구|통계/.test(all)) warnings.push("숫자가 있어요 — 출처를 근거 칸이나 캡션에 적어 주세요");
  if (letters(draft.caption) > CAPTION_MAX) blocking.push(`캡션은 ${CAPTION_MAX.toLocaleString("ko-KR")}자까지예요`);
  if (!draft.caption.trim()) warnings.push("캡션이 비어 있어요");
  if (draft.hashtags.length && (draft.hashtags.length < HASHTAGS.min || draft.hashtags.length > HASHTAGS.max)) warnings.push(`해시태그는 ${HASHTAGS.min}~${HASHTAGS.max}개가 좋아요 (지금 ${draft.hashtags.length}개)`);
  return { blocking, warnings };
}

/** A short fingerprint of what a draft shows (FNV-1a), to tell whether the confirmed card changed and how far the PD moved the AI draft. */
export function cardSignature(draft: Pick<CardDraft, "format" | "slides" | "caption" | "hashtags">) {
  let hash = 0x811c9dc5;
  for (const char of JSON.stringify([draft.format, draft.slides, draft.caption.trim(), draft.hashtags])) hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}
