import type { YpStage } from "../youtube-process/project.ts";
import type { YpCards } from "../youtube-process/stages.ts";
import { CARD_FORMATS, type CardFormatId } from "./formats.ts";

export const CARD_CATEGORIES = {
  guide: "안내형",
  webtoon: "웹툰형",
  story: "스토리형",
  information: "정보전달형",
} as const;
export type CardCategory = keyof typeof CARD_CATEGORIES;
export type LibraryCategory = CardCategory | "unassigned";
export const CATEGORY_IDS = Object.keys(CARD_CATEGORIES) as CardCategory[];
export const LIBRARY_LABELS = { all: "전체", ...CARD_CATEGORIES, unassigned: "미분류" };

const formatCategory: Record<CardFormatId, CardCategory> = {
  steps: "guide", webtoon: "webtoon", list: "information", myth: "information",
  quote: "information", compare: "information", structure: "information",
};

export function cardListSummary(cards: YpCards, stage: YpStage) {
  const selected = stage === "draft" ? cards.picked : cards.confirmed?.draftId || cards.picked;
  const drafts = Array.isArray(cards.drafts) ? cards.drafts : [];
  const draft = drafts.find(item => item?.id === selected);
  const format = draft && Object.hasOwn(CARD_FORMATS, draft.format) ? draft.format : null;
  return { format, slides: draft?.slides?.length ?? 0, candidates: drafts.length };
}
export type CardListSummary = ReturnType<typeof cardListSummary>;

export function libraryCategory(override?: CardCategory | null, summary?: CardListSummary): LibraryCategory {
  if (override && Object.hasOwn(CARD_CATEGORIES, override)) return override;
  return summary?.format ? formatCategory[summary.format] : "unassigned";
}
