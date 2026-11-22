// The 카드뉴스 step rules shared by the server and the demo store: how a save changes the cards record, and what 카드 확정 needs.
import { editableFields } from "../youtube-process/confirm.ts";
import type { YpProject } from "../youtube-process/project.ts";
import type { YpCards } from "../youtube-process/stages.ts";
import { cardProblems, emptyCardDraft, toonUploads, toonArtMissing, type CardDraft, type CardFormatId } from "./formats.ts";

export class CardError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 409) { super(message); this.code = code; this.status = status; }
}
export const CARD_DRAFTS_MAX = 12;

/** A draft as edited (its AI record stays the stored one), a new empty draft of a format, a draft removed, the one picked; or 내보내기's address. */
export interface CardsPatch { draft?: Omit<CardDraft, "at" | "by" | "ai">; add?: CardFormatId; remove?: string; pick?: string; focus?: string; brief?: string; exported?: { url?: string; episode?: number; withheldReason?: string; downloaded?: true } }

export function instagramPostId(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["www.instagram.com", "instagram.com"].includes(url.hostname) || url.username || url.password || url.port) return null;
    return /^\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1] ?? null;
  } catch { return null; }
}

export function cardPublicationProgress(cards: YpCards) {
  const draft = cards.drafts.find(row => row.id === (cards.confirmed?.draftId ?? cards.picked));
  const episodes = draft ? toonUploads(draft).length : 1;
  const saved = cards.exported;
  const stored = saved?.posts ?? (saved?.url && instagramPostId(saved.url) ? [{ episode: 1, url: saved.url }] : []);
  const seen = new Set<string>();
  const positions = new Set<number>();
  const posts = stored.filter(post => {
    const id = instagramPostId(post.url);
    if (!id || !Number.isInteger(post.episode) || post.episode < 1 || post.episode > episodes || positions.has(post.episode) || seen.has(id)) return false;
    positions.add(post.episode); seen.add(id); return true;
  }).sort((a, b) => a.episode - b.episode);
  const urls = posts.map(post => post.url);
  const missing = episodes - urls.length;
  const reason = saved?.withheldReason?.trim() ?? "";
  return { episodes, posts, urls, missing, reason };
}

export function finishedCardPublication(cards: YpCards, at: string): YpProject["yp"]["cardPublication"] {
  const { urls, posts, missing, reason } = cardPublicationProgress(cards);
  if (missing === 0) return { status: "published", at, urls, posts };
  if (reason) return { status: "withheld", at, urls, posts, reason };
  return undefined;
}

export function nextCards(project: Pick<YpProject, "yp">, current: YpCards, patch: CardsPatch, by: string, now: string, newId: () => string): YpCards {
  if (patch.exported) {
    if (project.yp.stage !== "upload" && project.yp.stage !== "done") throw new CardError("STAGE_LOCKED", "최종 검토 컨펌 뒤에 올린 주소를 남길 수 있어요.");
    if (project.yp.cardPublication && project.yp.stage === "done") throw new CardError("STAGE_LOCKED", "이미 마친 게시 기록이에요.");
    const evidence = patch.exported;
    const { episodes, posts, reason } = cardPublicationProgress(current);
    const episode = evidence.episode ?? 1;
    if (!Number.isInteger(episode) || episode < 1 || episode > episodes) throw new CardError("CARD_EPISODE_INVALID", "올린 화를 다시 선택해 주세요.", 400);
    const url = evidence.url?.trim();
    if (url !== undefined && (!instagramPostId(url) || posts.some(post => post.episode !== episode && instagramPostId(post.url) === instagramPostId(url)))) {
      throw new CardError("CARD_URL_INVALID", "해당 화의 고유한 인스타그램 게시물 주소를 넣어 주세요.", 400);
    }
    const next = url ? [...posts.filter(post => post.episode !== episode), { episode, url }].sort((a, b) => a.episode - b.episode) : posts;
    const downloadedEpisodes = evidence.downloaded ? [...new Set([...(current.exported?.downloadedEpisodes ?? []), episode])].sort((a, b) => a - b) : current.exported?.downloadedEpisodes;
    return { ...current, exported: { at: now, by, ...(downloadedEpisodes?.length ? { downloadedEpisodes } : {}), url: next.find(post => post.episode === 1)?.url ?? "", posts: next,
      withheldReason: next.length === episodes ? "" : evidence.withheldReason?.trim() ?? reason } };
  }
  if (project.yp.stage !== "draft" || editableFields(project, "draft") !== "all")
    throw new CardError("STAGE_LOCKED", project.yp.stage === "topic" ? "주제를 확정하면 카드를 만들 수 있어요." : "카드를 확정했어요. 고치려면 [다시 열기]를 눌러요.");
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
  return { ...current, drafts, picked, ...(patch.brief !== undefined ? { brief: patch.brief } : {}), ...(patch.focus !== undefined ? { focus: patch.focus } : {}) };
}

export const pickedDraft = (cards: YpCards) => cards.drafts.find(row => row.id === cards.picked) ?? null;
/** Why 카드 확정 cannot happen yet, or "". */
export function cardsMissing(cards: YpCards) {
  const draft = pickedDraft(cards);
  if (!draft) return cards.drafts.length ? "쓸 초안을 하나 골라 주세요" : "포맷을 골라 초안을 만들어 주세요";
  const art = toonArtMissing(draft);
  return cardProblems(draft).blocking[0] ?? (art >= 0 ? `${art + 1}장 그림을 그려 주세요` : "");
}
