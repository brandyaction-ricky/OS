// The 카드뉴스 step rules shared by the server and the demo store: how a save changes the cards record, and what 카드 확정 needs.
import { editableFields } from "../youtube-process/confirm.ts";
import type { YpProject } from "../youtube-process/project.ts";
import type { YpCards } from "../youtube-process/stages.ts";
import { cardProblems, emptyCardDraft, type CardDraft, type CardFormatId } from "./formats.ts";

export class CardError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 409) { super(message); this.code = code; this.status = status; }
}
export const CARD_DRAFTS_MAX = 12;

/** A draft as edited (its AI record stays the stored one), a new empty draft of a format, a draft removed, the one picked; or 내보내기's address. */
export interface CardsPatch { draft?: Omit<CardDraft, "at" | "by" | "ai">; add?: CardFormatId; remove?: string; pick?: string; focus?: string; exported?: { url: string } }

export function nextCards(project: Pick<YpProject, "yp">, current: YpCards, patch: CardsPatch, by: string, now: string, newId: () => string): YpCards {
  if (patch.exported) {
    if (project.yp.stage !== "upload" && project.yp.stage !== "done") throw new CardError("STAGE_LOCKED", "최종 검토 컨펌 뒤에 올린 주소를 남길 수 있어요.");
    if (!/^https:\/\/\S+$/.test(patch.exported.url)) throw new CardError("CARD_URL_INVALID", "https로 시작하는 주소를 넣어 주세요.", 400);
    return { ...current, exported: { at: now, by, url: patch.exported.url } };
  }
  if (project.yp.stage !== "draft" || editableFields(project, "draft") !== "all")
    throw new CardError("STAGE_LOCKED", project.yp.stage === "topic" ? "주제를 확정하면 카드를 만들 수 있어요." : "카드를 확정했어요. 고치려면 대표가 이 단계로 되돌려야 해요.");
  let drafts = current.drafts;
  if (patch.add) {
    if (drafts.length >= CARD_DRAFTS_MAX) throw new CardError("CARD_DRAFTS_FULL", `초안은 ${CARD_DRAFTS_MAX}개까지 둘 수 있어요. 안 쓰는 초안을 지워 주세요.`, 400);
    drafts = [...drafts, emptyCardDraft(patch.add, newId(), by, now)];
  }
  if (patch.draft) {
    const before = drafts.find(row => row.id === patch.draft!.id);
    if (!before) throw new CardError("CARD_DRAFT_NOT_FOUND", "그 초안을 찾지 못했어요. 새로 불러와 주세요.", 404);
    drafts = drafts.map(row => row.id === before.id ? { ...patch.draft!, at: now, by, ...(before.ai ? { ai: before.ai } : {}) } : row);
  }
  if (patch.remove) drafts = drafts.filter(row => row.id !== patch.remove);
  let picked = patch.pick !== undefined ? patch.pick : current.picked;
  if (picked && !drafts.some(row => row.id === picked)) {
    if (patch.pick) throw new CardError("CARD_DRAFT_NOT_FOUND", "고른 초안을 찾지 못했어요.", 404);
    picked = "";
  }
  // The first draft made is the one being worked on until another is picked.
  if (!picked && patch.add) picked = drafts.at(-1)!.id;
  return { ...current, drafts, picked, ...(patch.focus !== undefined ? { focus: patch.focus } : {}) };
}

export const pickedDraft = (cards: YpCards) => cards.drafts.find(row => row.id === cards.picked) ?? null;
/** Why 카드 확정 cannot happen yet, or "". */
export function cardsMissing(cards: YpCards) {
  const draft = pickedDraft(cards);
  if (!draft) return cards.drafts.length ? "쓸 초안을 하나 골라 주세요" : "포맷을 골라 초안을 만들어 주세요";
  return cardProblems(draft).blocking[0] ?? "";
}
