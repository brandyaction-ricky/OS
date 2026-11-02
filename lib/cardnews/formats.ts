// 카드뉴스 포맷 목록 (설계서 2026-10-30 §2): what each format is made of — slide kinds, how many, and the letters each field may
// hold. The screens, the AI job and the server check all read this one list; the 카드뉴스 정본 says how to write, not these numbers.
// Limits count letters with spaces; they start from the font size and the 888px text width and are tuned while the 정본 is ground.

export const CARD_SIZE = { width: 1080, height: 1350 } as const;
export const CARD_MAX_SLIDES = 10;

export type CardFormatId = "list" | "myth" | "quote" | "compare" | "steps" | "structure" | "webtoon";
export const CARD_SLIDE_TYPES = ["cover", "item", "summary", "pair", "line", "compare", "step", "map", "part", "end", "toon", "panel"] as const;
export type CardSlideType = typeof CARD_SLIDE_TYPES[number];
export interface CardField { key: string; label: string; max: number; optional?: boolean }
/** photo: the card can hold one photo the PD puts in (디자인 정본 §8: real material first; a card with a diagram has none). */
export interface CardSlideSpec { type: CardSlideType; label: string; min: number; max: number; fields: CardField[]; photo?: boolean }
export interface CardFormat { id: CardFormatId; name: string; when: string; slides: CardSlideSpec[] }

const cover: CardSlideSpec = { type: "cover", label: "표지", min: 1, max: 1, photo: true, fields: [{ key: "head", label: "헤드 카피", max: 22 }, { key: "sub", label: "서브", max: 30, optional: true }] };
const end: CardSlideSpec = { type: "end", label: "마무리", min: 1, max: 1, fields: [{ key: "line", label: "마무리 문장", max: 30 }, { key: "action", label: "다음 행동", max: 14 }] };
const summary: CardSlideSpec = { type: "summary", label: "정리", min: 1, max: 1, fields: [{ key: "line", label: "한 줄 정리", max: 24 }] };

export const CARD_FORMATS: Record<CardFormatId, CardFormat> = {
  list: { id: "list", name: "정리형", when: "방법 · 신호 · 이유를 나열할 때 (롱폼 원고에 잘 맞아요)", slides: [cover,
    { type: "item", label: "항목", min: 3, max: 7, photo: true, fields: [{ key: "title", label: "소제목", max: 16 }, { key: "body", label: "설명", max: 60 }] }, summary, end] },
  myth: { id: "myth", name: "오해와 진실형", when: "흔한 생각을 뒤집을 때 (저장 · 공유가 잘 돼요)", slides: [cover,
    { type: "pair", label: "오해와 진실", min: 3, max: 5, fields: [{ key: "myth", label: "흔한 생각", max: 28 }, { key: "fact", label: "실제", max: 50 }, { key: "basis", label: "근거", max: 40, optional: true }] }, summary, end] },
  quote: { id: "quote", name: "한 문장형", when: "통찰을 한 줄씩 (스레드 글 · 숏폼 대본에 잘 맞아요)", slides: [cover,
    { type: "line", label: "문장", min: 4, max: 8, photo: true, fields: [{ key: "text", label: "문장", max: 45 }, { key: "note", label: "덧말", max: 30, optional: true }] }, end] },
  // 디자인 정본 §8–9 (2026-11-02): a format for each diagram — 차이 (좌우 비교), 과정 (단계별 흐름), 구성 요소 (중심에서 가지로).
  compare: { id: "compare", name: "비교형", when: "같은 기준으로 두 쪽을 나란히 볼 때 (이전 · 이후, 흔한 방식 · 권하는 방식)", slides: [cover,
    { type: "compare", label: "비교", min: 2, max: 5, fields: [{ key: "title", label: "비교 기준", max: 18 }, { key: "leftLabel", label: "왼쪽 이름", max: 8 },
      { key: "left", label: "왼쪽", max: 30 }, { key: "rightLabel", label: "오른쪽 이름", max: 8 }, { key: "right", label: "오른쪽", max: 30 }, { key: "note", label: "설명", max: 50, optional: true }] }, summary, end] },
  steps: { id: "steps", name: "단계형", when: "순서대로 따라 하는 방법 · 과정일 때 (실행 · 체크리스트)", slides: [cover,
    { type: "step", label: "단계", min: 3, max: 6, photo: true, fields: [{ key: "title", label: "단계 이름", max: 16 }, { key: "body", label: "할 일", max: 60 }] }, summary, end] },
  structure: { id: "structure", name: "구조형", when: "하나의 개념이 몇 가지 요소로 이뤄질 때 (구성 · 분해)", slides: [cover,
    { type: "map", label: "구조도", min: 1, max: 1, fields: [{ key: "center", label: "중심 개념", max: 12 }, { key: "note", label: "설명", max: 50, optional: true }] },
    { type: "part", label: "요소", min: 2, max: 5, photo: true, fields: [{ key: "title", label: "요소 이름", max: 12 }, { key: "body", label: "설명", max: 60 }] }, end] },
  // 웹툰형 (대표 2026-11-02, 「웹툰형 캐릭터 설정」): one 화 of an Instagram series in 8~10 cards. Each 칸 is a picture filling the card
  // (drawn with 「AI로 그리기」 from its 장면, with the 캐릭터 창고 faces of 나오는 사람) and the words sit on it in boxes and bubbles.
  webtoon: { id: "webtoon", name: "웹툰형", when: "주인공의 하루로 이야기를 들려줄 때 (인스타 연재 · 한 화 8~10장)", slides: [
    { type: "toon", label: "웹툰 표지", min: 1, max: 1, photo: true, fields: [{ key: "episode", label: "화", max: 6 }, { key: "title", label: "제목", max: 20 }, { key: "scene", label: "표지 장면 (그릴 것)", max: 300, optional: true }] },
    { type: "panel", label: "칸", min: 5, max: 7, photo: true, fields: [{ key: "scene", label: "장면 (그릴 것)", max: 300, optional: true }, { key: "cast", label: "나오는 사람", max: 20, optional: true },
      { key: "narration", label: "해설 상자", max: 40, optional: true }, { key: "talk", label: "대사", max: 40, optional: true }, { key: "reply", label: "받는 대사", max: 40, optional: true },
      { key: "shout", label: "외침", max: 14, optional: true }, { key: "sfx", label: "효과음", max: 6, optional: true }] },
    { ...summary, label: "오늘의 한 줄" }, end] },
};
/** The fields a 웹툰 card keeps for drawing its picture, never printed on it. */
export const CARD_DRAW_FIELDS = ["scene", "cast"];
/** The first 웹툰 card still without its picture (-1 when all are drawn): 카드 확정 waits for it. */
export const toonArtMissing = (draft: Pick<CardDraft, "format" | "slides">) =>
  draft.format === "webtoon" ? draft.slides.findIndex(slide => (slide.type === "toon" || slide.type === "panel") && !slide.photo) : -1;
export const CARD_FORMAT_IDS = Object.keys(CARD_FORMATS) as CardFormatId[];
export const isCardFormat = (value: unknown): value is CardFormatId => typeof value === "string" && value in CARD_FORMATS;

/** A photo kept in the project's files (youtube/<project>/card/…), with its size so the card keeps its ratio. */
export interface CardPhoto { path: string; w: number; h: number }
export interface CardSlide { type: CardSlideType; fields: Record<string, string>; photo?: CardPhoto }
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

/** `*구절*` marks the one phrase read first on a card (디자인 정본 §7: blue, gold on a blue card). The marks are not counted as letters. */
export const CARD_MARK = /\*{1,2}([^*\n]+?)\*{1,2}/;
export const plainCardText = (value: string) => value.split(CARD_MARK).join("");
export const cardLetters = (value: string) => [...plainCardText(value)].length;
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
    if (slide.photo && !spec.photo) blocking.push(`${index + 1}장 ${spec.label}에는 사진을 넣지 않아요 — 도식이 그 자리예요`);
    // An AI draft arrives without pictures, so a missing one is pointed out here and only 카드 확정 waits for it (cardsMissing).
    if (draft.format === "webtoon" && spec.photo && !slide.photo) warnings.push(`${index + 1}장 그림이 아직 없어요 — 「AI로 그리기」로 그려요`);
    for (const field of spec.fields) {
      const value = (slide.fields[field.key] ?? "").trim();
      if (!value && !field.optional) blocking.push(`${index + 1}장 ${field.label}을 써 주세요`);
      if (cardLetters(value) > field.max) blocking.push(`${index + 1}장 ${field.label}이 ${cardLetters(value) - field.max}자 넘쳐요 (${field.max}자까지)`);
      if (value.length >= 8) { if (seen.has(value)) warnings.push(`${seen.get(value)! + 1}장과 ${index + 1}장에 같은 문장이 있어요`); else seen.set(value, index); }
    }
    const marks = Object.values(slide.fields).reduce((sum, value) => sum + (value.split(CARD_MARK).length - 1) / 2, 0);
    if (marks > 1) warnings.push(`${index + 1}장에 강조가 ${marks}곳이에요 — 한 장에 하나만 *별표*로 감싸요`);
  });
  const all = [...draft.slides.flatMap(slide => Object.values(slide.fields).map(plainCardText)), draft.caption].join("\n");
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
