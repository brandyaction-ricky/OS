import { z } from "zod";
// 카드뉴스 포맷 목록 (설계서 2026-10-30 §2): what each format is made of — slide kinds, how many, and the letters each field may
// hold. The screens, the AI job and the server check all read this one list; the 카드뉴스 정본 says how to write, not these numbers.
// Limits count letters with spaces; they start from the font size and the 888px text width and are tuned while the 정본 is ground.

export const CARD_SIZE = { width: 1080, height: 1350 } as const;
export const CARD_MAX_SLIDES = 10;
/** 웹툰형 is one story in as many cards as it needs, put up as several 화 (대표 2026-11-04); an Instagram post holds 20 pictures. */
export const TOON_MAX_SLIDES = 100;
export const TOON_UPLOAD_MAX = 20;
export const cardMaxSlides = (format: CardFormatId) => format === "webtoon" ? TOON_MAX_SLIDES : CARD_MAX_SLIDES;

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
    { type: "item", label: "항목", min: 3, max: 7, photo: true, fields: [{ key: "title", label: "소제목", max: 16 }, { key: "body", label: "설명", max: 60 }, { key: "before", label: "바꾸기 전 문장", max: 38, optional: true }] }, { ...summary, fields: [...summary.fields, { key: "worksheet", label: "메모 양식 (한 줄에 한 항목)", max: 48, optional: true }] }, end] },
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
  // 웹툰형 (대표 2026-11-02, 「웹툰형 캐릭터 설정」): an Instagram series. Each 칸 is a picture filling the card (drawn with 「AI로
  // 그리기」 from its 장면, with the 캐릭터 창고 faces of 나오는 사람) and the words sit on it in boxes and bubbles. Since 2026-11-04 the story
  // takes as many 칸 as it needs and each 웹툰 표지 starts the next 화 (toonUploads); the 오늘의 한 줄 and 마무리 close the last 화.
  webtoon: { id: "webtoon", name: "웹툰형", when: "주인공의 이야기를 연재할 때 (장수 제한 없이 짜고, 웹툰 표지마다 한 화로 나눠 올려요 · 한 화 20장까지)", slides: [
    { type: "toon", label: "웹툰 표지", min: 1, max: 10, photo: true, fields: [{ key: "episode", label: "화", max: 6 }, { key: "title", label: "제목", max: 20 }, { key: "scene", label: "표지 장면 (그릴 것)", max: 300, optional: true }] },
    { type: "panel", label: "칸", min: 5, max: TOON_MAX_SLIDES - 3, photo: true, fields: [{ key: "scene", label: "장면 (그릴 것)", max: 300, optional: true }, { key: "cast", label: "나오는 사람", max: 20, optional: true },
      { key: "narration", label: "해설 상자", max: 40, optional: true }, { key: "talk", label: "대사", max: 40, optional: true }, { key: "reply", label: "받는 대사", max: 40, optional: true },
      { key: "think", label: "속마음", max: 30, optional: true },
      { key: "shout", label: "외침", max: 14, optional: true }, { key: "sfx", label: "효과음", max: 6, optional: true }] },
    { ...summary, label: "오늘의 한 줄" }, end] },
};
/** The fields a 웹툰 card keeps for drawing its picture, never printed on it. */
export const CARD_DRAW_FIELDS = ["scene", "cast"];
/** Where a 웹툰 bubble's tail points, in % of the card: the PD taps the speaker on the preview (stored as `talkAt` / `replyAt`, "x,y");
 * until then the one in front is taken to stand left and the one answering right, as the scene is written to draw them. The bubble sits
 * on its speaker's half of the card. `sfxAt` is the battery character a 배터리 숫자 (「2%」) belongs to; it has no default spot. */
export const TOON_AIM = { talk: [28, 40], reply: [64, 40], sfx: [24, 52] } as const;
export function toonAim(slide: Pick<CardSlide, "fields">, key: keyof typeof TOON_AIM): [number, number] {
  const match = /^(\d{1,3}),(\d{1,3})$/.exec(slide.fields[`${key}At`]?.trim() ?? "");
  return match ? [Math.min(100, Number(match[1])), Math.min(100, Number(match[2]))] : [...TOON_AIM[key]];
}
/** A 효과음 that is only a percentage (「2%」 「80 %」) is a battery reading: the card draws it as a phone battery, not as tilted letters. */
export function toonBattery(sfx: string | undefined): number | null {
  const match = /^\s*(\d{1,3})\s*%\s*$/.exec(sfx ?? "");
  return match ? Math.min(100, Number(match[1])) : null;
}
/** The first 웹툰 card still without its picture (-1 when all are drawn): 카드 확정 waits for it. */
export const toonArtMissing = (draft: Pick<CardDraft, "format" | "slides">) =>
  draft.format === "webtoon" ? draft.slides.findIndex(slide => (slide.type === "toon" || slide.type === "panel") && !slide.photo) : -1;
export const CARD_FORMAT_IDS = Object.keys(CARD_FORMATS) as CardFormatId[];
export const isCardFormat = (value: unknown): value is CardFormatId => typeof value === "string" && value in CARD_FORMATS;

/** A photo kept in the project's files (youtube/<project>/card/…), with its size so the card keeps its ratio. */
export interface CardPhoto { path: string; w: number; h: number }
export const MYIN_CAST = {
  "인연이": "관계",
  "마음이": "관계",
  "만남이": "관계",
  "맞춤이": "관계",
  "원만이": "관계",
  "짝꿍이": "관계",
  "친밀이": "관계",
  "구현이": "성취",
  "끝장이": "성취",
  "추월이": "성취",
  "향상이": "성취",
  "만약이": "실행",
  "방향이": "실행",
  "약속이": "실행",
  "자율이": "실행",
  "효율이": "실행",
  "인정이": "영향",
  "주목이": "영향",
  "해결이": "영향",
  "육성이": "영향",
  "전달이": "영향",
  "성찰이": "의미",
  "소신이": "의미",
  "연결이": "의미",
  "원칙이": "의미",
  "까닭이": "이해",
  "수집이": "이해",
  "응용이": "이해",
  "탐색이": "이해",
  "파악이": "이해"
} as const;
export const GUIDE_CAST = ["탐색이", "전달이", "까닭이", "만남이", "성찰이", "약속이"] as const;
export const MYIN_SCENE_CANON = `마이인 정보전달형 · 2D 장면 기준
주제와 독자가 정해지면 장마다 무엇을 새로 알게 되는지 정하고, 실제로 보일 행동과 소품을 먼저 고릅니다. 그 행동을 표현할 인물을 선택합니다. 탐색이는 관찰·탐색, 전달이는 설명·공유, 까닭이는 원인·차이 확인, 만남이는 다른 사람과 시도, 성찰이는 되짚기·기록, 약속이는 다음 행동·약속에 어울립니다. 순서나 등장 횟수를 고정하지 않습니다.
여섯 장 정리형의 기본 흐름은 독자의 질문 → 두 행동 비교 → 구체적인 한 동작 → 다른 상황에서 시험 → 독자가 직접 쓸 세 줄 → 오늘 할 행동입니다. 다른 하위 포맷은 그 포맷의 장 구조를 따릅니다. 주제를 바꾸면 장소·상대·소품·시선·손동작을 새로 기획합니다. 연속 동작을 비교할 때만 같은 인물과 장소를 의도적으로 이어 씁니다.
1080×1350. 검정 바탕, 연두색 제목, 흰 본문과 하단 장면. 그림에는 글자를 그리지 않고 문구는 별도로 조판합니다. 그림은 가이드 원화의 눈, 머리와 몸 비율, 윤곽선, 고유 색과 소품을 유지한 평면 2D입니다. 기록 장은 작은 인물을 제목 옆에 두고 손으로 쓸 공간 세 줄을 남깁니다.`;
export type MyinCharacter = keyof typeof MYIN_CAST;
export const characterSceneSchema = z.object({
  kind: z.enum(["character", "comparison", "worksheet"]),
  character: z.enum(Object.keys(MYIN_CAST) as [MyinCharacter, ...MyinCharacter[]]).default("탐색이"),
  side: z.enum(["left", "right"]).default("right"), size: z.enum(["small", "large"]).default("large"),
  action: z.string().trim().min(2).max(320).optional(), dark: z.boolean().optional(), reason: z.string().max(120).optional(),
});
export interface CharacterScene {
  kind: "character" | "comparison" | "worksheet";
  character: MyinCharacter;
  side: "left" | "right";
  size: "small" | "large";
  dark?: boolean;
  reason?: string;
  action?: string;
}
export function characterAsset(name: string) {
  return Object.hasOwn(MYIN_CAST, name) ? `/myin-card-cast/${name}.png` : undefined;
}
export interface CardSlide { scene?: CharacterScene; layout?: "spotlight"; type: CardSlideType; fields: Record<string, string>; photo?: CardPhoto }
import type { CanonTrace } from "../youtube-process/canon-trace";
export interface CardDraft {
  id: string; format: CardFormatId; slides: CardSlide[]; caption: string; hashtags: string[]; at: string; by: string;
  /** Who drafted it: a staff member's own AI or the company GPT, and under which 카드뉴스 정본 version (for the 정본 다듬기 comparison). */
  /** sig: cardSignature of the draft as the AI handed it in, so 카드 확정 can tell how far the PD changed it. */
  ai?: { trace?: CanonTrace[]; by: string; model: string; at: string; jobId: string; canon: string; sig: string; why?: string };
}

export const slideSpec = (format: CardFormatId, type: CardSlideType) => CARD_FORMATS[format].slides.find(spec => spec.type === type);
/** A slide's place in its format's order. 웹툰 표지 and 칸 share one, so the next 화 can start between two 칸. */
const orderRank = (format: CardFormatId, type: CardSlideType) =>
  CARD_FORMATS[format].slides.findIndex(spec => spec.type === (format === "webtoon" && type === "toon" ? "panel" : type));
/** The posts a draft goes up as: one for most formats; for 웹툰형 one per 웹툰 표지, the 오늘의 한 줄 and 마무리 riding on the last. */
export function toonUploads(draft: Pick<CardDraft, "format" | "slides">) {
  const starts = draft.format === "webtoon" ? draft.slides.flatMap((slide, index) => slide.type === "toon" ? [index] : []) : [];
  if (starts[0] !== 0) starts.unshift(0);
  return starts.map((from, at) => ({ from, to: starts[at + 1] ?? draft.slides.length }));
}
/** The 「n / total」 in a card's corner, counted within its post. */
export function cardPage(draft: Pick<CardDraft, "format" | "slides">, index: number) {
  const post = toonUploads(draft).find(row => index >= row.from && index < row.to) ?? { from: 0, to: draft.slides.length };
  return `${index - post.from + 1} / ${post.to - post.from}`;
}
const blank = (spec: CardSlideSpec): CardSlide => ({ type: spec.type, fields: Object.fromEntries(spec.fields.map(field => [field.key, ""])) });
/** A new draft with each slide kind at its fewest. */
export function emptyCardDraft(format: CardFormatId, id: string, by: string, at: string): CardDraft {
  return { id, format, slides: CARD_FORMATS[format].slides.flatMap(spec => Array.from({ length: spec.min }, () => blank(spec))), caption: "", hashtags: [], at, by };
}
/** One more body slide after the last of its kind (a 웹툰 표지 after the last 칸, as the next 화), when the format allows it. */
export function addCardSlide(draft: CardDraft, type: CardSlideType): CardDraft {
  const spec = slideSpec(draft.format, type);
  const count = draft.slides.filter(slide => slide.type === type).length;
  if (!spec || count >= spec.max || draft.slides.length >= cardMaxSlides(draft.format)) return draft;
  const later = draft.slides.findIndex(slide => orderRank(draft.format, slide.type) > orderRank(draft.format, type));
  const at = later < 0 ? draft.slides.length : later, slide = blank(spec);
  if (type === "toon") slide.fields.episode = `${count + 1}화`;
  return { ...draft, slides: [...draft.slides.slice(0, at), slide, ...draft.slides.slice(at)] };
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
  if (slides.some((row, at) => at > 0 && orderRank(draft.format, row.type) < orderRank(draft.format, slides[at - 1].type))) return draft;
  if (draft.format === "webtoon" && slides[0].type !== "toon") return draft;
  return { ...draft, slides };
}

/** Parsing is for storage only: never replace the text in an input while someone is typing Korean. */
export const parseCardHashtags = (text: string) => [...new Set(text.split(/[\s,#]+/u).map(tag => tag.trim()).filter(Boolean))].slice(0, 30);

/** `*구절*` marks the one phrase read first on a card (디자인 정본 §7: blue, gold on a blue card). The marks are not counted as letters. */
export const CARD_MARK = /\*{1,2}([^*\n]+?)\*{1,2}/;
export const plainCardText = (value: string) => value.split(CARD_MARK).join("");
export const cardLetters = (value: string) => [...plainCardText(value)].length;
const letters = (value: string) => [...value].length;
/** A field name with 을/를 · 이/가 · 은/는 as its last letter takes them (받침 or not); anything but a Hangul syllable counts as 받침. */
const josa = (word: string, batchim: string, open: string) => {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return word + (code >= 0 && code < 11172 && code % 28 === 0 ? open : batchim);
};
// Owner rules carried into every format: the 진단 is paid (발행 키트 정본 · 2026-10-26), and '여러분' is not our voice (말투 정본).
const BANNED: [RegExp, string][] = [[/무료\s*(진단|검사)/, "진단은 유료예요 — ‘무료 진단’이라고 쓰지 않아요"], [/여러분/, "‘여러분’은 쓰지 않아요 (말투 정본)"]];
const editorialTerms = /원본|제공된|가상\s*장면|원고|(?<![가-힣])정본/;
export function firstCardLine(format: CardFormatId, slide: CardSlide) {
  return slideSpec(format, slide.type)?.fields.filter(field => !CARD_DRAW_FIELDS.includes(field.key))
    .map(field => plainCardText(slide.fields[field.key] ?? "").trim()).find(Boolean) || "작성 전";
}
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
  if (draft.slides.length > cardMaxSlides(draft.format)) blocking.push(`카드는 ${cardMaxSlides(draft.format)}장까지예요`);
  for (const spec of format.slides) {
    const count = draft.slides.filter(slide => slide.type === spec.type).length;
    // A story runs over several 웹툰 카드뉴스 (one 웹툰 화 each, 대표 2026-11-09): only its last one closes with 오늘의 한 줄 and 마무리.
    if (draft.format === "webtoon" && !count && (spec.type === "summary" || spec.type === "end")) continue;
    if (count < spec.min || count > spec.max) blocking.push(spec.min === spec.max ? `${spec.label} 장이 ${spec.min}장 있어야 해요` : `${josa(spec.label, "은", "는")} ${spec.min}~${spec.max}장이에요 (지금 ${count}장)`);
  }
  if (draft.slides.some((slide, index) => index && orderRank(draft.format, slide.type) < orderRank(draft.format, draft.slides[index - 1].type))) blocking.push("카드 순서가 포맷과 달라요");
  if (draft.format === "webtoon") {
    if (draft.slides[0]?.type !== "toon") blocking.push("첫 장은 웹툰 표지예요");
    toonUploads(draft).forEach((post, at) => {
      const name = draft.slides[post.from]?.fields.episode?.trim() || `${at + 1}화`;
      if (post.to - post.from > TOON_UPLOAD_MAX) blocking.push(`${josa(name, "이", "가")} ${post.to - post.from}장이에요 — 한 번에 ${TOON_UPLOAD_MAX}장까지 올릴 수 있어요`);
      if (!draft.slides.slice(post.from, post.to).some(slide => slide.type === "panel")) blocking.push(`${name}에 칸이 없어요`);
    });
  }
  const seen = new Map<string, number>();
  draft.slides.forEach((slide, index) => {
    const spec = slideSpec(draft.format, slide.type);
    if (!spec) { blocking.push(`${index + 1}장은 이 포맷에 없는 카드예요`); return; }
    if (slide.photo && !spec.photo && !slide.scene?.action) blocking.push(`${index + 1}장 ${spec.label}에는 사진을 넣지 않아요 — 도식이 그 자리예요`);
    // An AI draft arrives without pictures, so a missing one is pointed out here and only 카드 확정 waits for it (cardsMissing).
    if (draft.format === "webtoon" && spec.photo && !slide.photo) warnings.push(`${index + 1}장 그림이 아직 없어요 — 「AI로 그리기」로 그려요`);
    for (const field of spec.fields) {
      const value = (slide.fields[field.key] ?? "").trim();
      const term = !CARD_DRAW_FIELDS.includes(field.key) && plainCardText(value).match(editorialTerms)?.[0];
      if (term) blocking.push(`${index + 1}장 ${field.label} · 제작 용어 ‘${term}’를 독자에게 보여 줄 말로 바꿔 주세요`);
      if (!value && !field.optional) blocking.push(`${index + 1}장 ${josa(field.label, "을", "를")} 써 주세요`);
      if (cardLetters(value) > field.max) blocking.push(`${index + 1}장 ${josa(field.label, "이", "가")} ${cardLetters(value) - field.max}자 넘쳐요 (${field.max}자까지)`);
      if (value.length >= 8) { if (seen.has(value)) warnings.push(`${seen.get(value)! + 1}장과 ${index + 1}장에 같은 문장이 있어요`); else seen.set(value, index); }
    }
    const marks = Object.values(slide.fields).reduce((sum, value) => sum + (value.split(CARD_MARK).length - 1) / 2, 0);
    if (marks > 1) warnings.push(`${index + 1}장에 강조가 ${marks}곳이에요 — 한 장에 하나만 *별표*로 감싸요`);
  });
  const publicFields = draft.slides.flatMap((slide, index) => (slideSpec(draft.format, slide.type)?.fields ?? [])
    .filter(field => !CARD_DRAW_FIELDS.includes(field.key))
    .map(field => ({ label: `${index + 1}장 ${field.label}`, text: plainCardText(slide.fields[field.key] ?? "") })));
  publicFields.push({ label: "캡션", text: draft.caption });
  const all = publicFields.map(field => field.text).join("\n");
  for (const [pattern, message] of BANNED) if (pattern.test(all)) warnings.push(message);
  const statistic = publicFields.find(field => /\d+(\.\d+)?\s*(%|퍼센트|배|명 중)/.test(field.text));
  if (statistic && !/출처|자료|조사|연구|통계/.test(all)) warnings.push(`${statistic.label} · 숫자가 있어요 — 근거 칸이나 캡션 마지막 줄에 출처(기관 · 연도 · 대상)를 적어 주세요`);
  if (letters(draft.caption) > CAPTION_MAX) blocking.push(`캡션은 ${CAPTION_MAX.toLocaleString("ko-KR")}자까지예요`);
  const captionTerm = draft.caption.match(editorialTerms)?.[0];
  const tagTerm = draft.hashtags.join(" ").match(editorialTerms)?.[0];
  if (tagTerm) blocking.push(`해시태그 · 제작 용어 ‘${tagTerm}’를 바꿔 주세요`);
  if (captionTerm) blocking.push(`캡션 · 제작 용어 ‘${captionTerm}’를 바꿔 주세요`);
  if (letters(draft.caption.split(/\r?\n/).slice(0, 2).join("\n")) > 125) warnings.push("캡션 첫 두 줄을 125자 이내로 줄여 보세요");
  if (letters(draft.caption.trim()) < 300 || letters(draft.caption.trim()) > 800) warnings.push("캡션은 300~800자가 좋아요");
  if ((draft.hashtags.length < HASHTAGS.min || draft.hashtags.length > HASHTAGS.max)) warnings.push(`해시태그는 ${HASHTAGS.min}~${HASHTAGS.max}개가 좋아요 (지금 ${draft.hashtags.length}개)`);
  return { blocking, warnings };
}

/** A short fingerprint of what a draft shows (FNV-1a), to tell whether the confirmed card changed and how far the PD moved the AI draft. */
export function cardSignature(draft: Pick<CardDraft, "format" | "slides" | "caption" | "hashtags">) {
  let hash = 0x811c9dc5;
  for (const char of JSON.stringify([draft.format, draft.slides, draft.caption.trim(), draft.hashtags])) hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}
