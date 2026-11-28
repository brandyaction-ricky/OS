import { z } from "zod";
import { CARD_FORMAT_IDS, CARD_FORMATS, cardMaxSlides, emptyCardDraft, type CardFormatId } from "./formats.ts";

export const PRODUCTION_TYPES = {
  information: { name: "정보형", detail: "핵심을 문장과 사례로 전달", example: "list" },
  explanation: { name: "설명형", detail: "비교와 도식으로 관계를 설명", example: "compare" },
  comic: { name: "웹툰형", detail: "인물의 행동과 대사로 전개", example: "webtoon" },
} as const;
export const FORMAT_INPUT = {
  list: { type: "information", label: "정리할 항목", hint: "한 줄에 한 가지 신호나 방법" },
  myth: { type: "information", label: "오해와 확인된 사실", hint: "흔한 오해와 이를 설명할 근거" },
  quote: { type: "information", label: "전달할 문장", hint: "독자에게 남기고 싶은 문장" },
  compare: { type: "explanation", label: "비교 대상", hint: "같은 기준으로 비교할 두 사례" },
  steps: { type: "explanation", label: "실행 순서", hint: "독자가 따라 할 행동을 순서대로" },
  structure: { type: "explanation", label: "핵심 개념과 구성 요소", hint: "중심 개념과 이를 이루는 요소" },
  webtoon: { type: "comic", label: "등장인물과 장면", hint: "누가 어디에서 무엇을 하는지" },
} as const satisfies Record<CardFormatId, { type: keyof typeof PRODUCTION_TYPES; label: string; hint: string }>;
export const photoSchema = z.object({ path: z.string().min(1).max(200), w: z.number().int().min(1).max(20000), h: z.number().int().min(1).max(20000) }).strict();
export const productionSchema = z.object({
  title: z.string().max(200), format: z.enum(CARD_FORMAT_IDS as [CardFormatId, ...CardFormatId[]]),
  memo: z.string().max(16000), direction: z.string().max(1800), detail: z.string().max(2000),
  canonInsight: z.string().max(800).optional(),
  reference: z.object({ purpose: z.enum(["design", "use"]), photo: photoSchema }).optional(),
}).strict();
export type ProductionInput = z.infer<typeof productionSchema>;
export function formatRange(id: CardFormatId) {
  const rows = CARD_FORMATS[id].slides;
  const count = rows.reduce((n, r) => n + r.min, 0);
  return { count, min: count, max: Math.min(cardMaxSlides(id), rows.reduce((n, r) => n + r.max, 0)) };
}
// Keep the author's source intact in production. Seed only editable fields, leaving missing
// material visible for review instead of inventing quotations, evidence or a conclusion.
export function productionOutline(input: ProductionInput, id: string, by: string, at: string) {
  const draft = emptyCardDraft(input.format, id, by, at);
  draft.outline = true;
  draft.production = input;
  const lines = input.memo.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const details = input.detail.split(/\n+/).map(line => line.trim()).filter(Boolean);
  let item = 0;
  for (const slide of draft.slides) {
    switch (slide.type) {
      case "cover": slide.fields.head = input.title; break;
      case "toon": slide.fields.title = input.title; slide.fields.episode = "1화"; break;
      case "summary": case "end": break;
      case "map": slide.fields.center = input.title; break;
      default: {
        const fields = slide.fields;
        const line = lines[item] ?? "";
        if ("body" in fields) { fields.title = details[item] ?? ""; fields.body = line; }
        else if ("myth" in fields) { fields.myth = details[item] ?? ""; fields.fact = line; }
        else if ("left" in fields) { fields.title = details[item] ?? ""; fields.left = line; }
        else if ("talk" in fields) { fields.scene = details[item] ?? ""; fields.talk = line; }
        else if ("text" in fields) fields.text = line;
        item++;
      }
    }
  }
  for (const slide of draft.slides) {
    for (const [key,value] of Object.entries(slide.fields)) slide.fields[key] = value.slice(0, 400);
  }
  if (input.reference?.purpose === "use") draft.slides[0].photo = input.reference.photo;
  return draft;
}
