// CTA 일괄 관리 (로건 요청 10/30, 대표 결정 2026-10-31 「④ 진행」): when a 진단 이름 · 링크 · 멘트 changes, every uploaded video's
// description carrying the old words gets the new ones at once — after a preview, with a record that can be undone.
// YouTube offers no API for pinning a comment or editing an end screen, so those stay a person's job.
export interface CtaVideo { id: string; title: string; description: string; publishedAt: string }
export interface CtaItem { videoId: string; title: string; before: string; after: string; ok: boolean; error?: string; undone?: boolean }
export interface CtaChange { id: string; at: string; by: string; find: string; replace: string; items: CtaItem[]; undoneAt?: string }

export const CTA_MAX_VIDEOS = 50;
export const DESCRIPTION_MAX = 5000;
/** YouTube quota: videos.update costs 50 units of the channel project's 10,000 a day. */
export const ctaQuota = (videos: number) => videos * 50;

/** The description with every `find` replaced, or why it cannot be. */
export function ctaPlan(description: string, find: string, replace: string) {
  if (!find) return { problem: "찾을 말을 써 주세요" } as const;
  const count = description.split(find).length - 1;
  if (!count) return { problem: "찾을 말이 없어요" } as const;
  const next = description.split(find).join(replace);
  if (next.length > DESCRIPTION_MAX) return { problem: `바꾸면 설명란이 ${DESCRIPTION_MAX.toLocaleString("ko-KR")}자를 넘어요` } as const;
  return { next, count } as const;
}

/** The words around the first match, before and after the change (what a person checks before pressing). */
export function ctaContext(description: string, find: string, replace: string, around = 24) {
  const at = description.indexOf(find);
  if (at < 0) return null;
  const head = description.slice(Math.max(0, at - around), at), tail = description.slice(at + find.length, at + find.length + around);
  const trim = (text: string) => text.replace(/\s+/g, " ");
  return { before: `${at > around ? "…" : ""}${trim(head)}[${trim(find)}]${trim(tail)}…`, after: `${at > around ? "…" : ""}${trim(head)}[${trim(replace)}]${trim(tail)}…` };
}

/** The uploaded videos whose description has `find`, newest first. */
export function ctaPreview(videos: CtaVideo[], find: string, replace: string) {
  return videos.flatMap(video => {
    const plan = ctaPlan(video.description, find, replace);
    const context = ctaContext(video.description, find, replace);
    return "next" in plan && context ? [{ id: video.id, title: video.title, publishedAt: video.publishedAt, count: plan.count, ...context }] : [];
  }).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

/** Undo puts back only a description nobody changed since — one edited after the change is left as it is. */
export const ctaUndoable = (current: string, item: CtaItem) => item.ok && !item.undone && current === item.after;
