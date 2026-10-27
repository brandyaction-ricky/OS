// 내 컴퓨터로 시안 (owner decision 2026-10-27): who may take a v13 run's ③ draft step, and when a member's own Mac can take one.

interface PlacedRun { local?: { by: string } | null; clipsReview?: unknown }

/** A ③ draft promised to a member's own Mac (after the drafts are confirmed, everything is the render PC's again). */
export const localDraft = (run: PlacedRun) => Boolean(run.local) && !run.clipsReview;

/** The render PC (no owner) takes everything but those drafts; a member's Mac takes only its own. */
export const draftFilter = (owner?: string) => owner
  ? (run: PlacedRun) => localDraft(run) && run.local!.by === owner
  : (run: PlacedRun) => !localDraft(run);

export interface LocalRenderStatus { state: "online" | "offline" | "unknown"; ageSeconds: number | null; engine: "same" | "different" | "unknown"; job: { step: string } | null }

/** Why 내 컴퓨터 cannot take this video's drafts right now, or null when it can (`ready`: its stage 1 left the voice for staff Macs). */
export function localBlocker(status: LocalRenderStatus | null, ready = true) {
  if (!ready) return "이 영상은 렌더 PC로 만들어요 · 내 컴퓨터용 음성이 없어요";
  if (!status || status.state === "unknown") return "아직 연결하지 않았어요";
  if (status.state === "offline") return "내 컴퓨터가 꺼져 있어요";
  if (status.engine === "different") return "엔진이 렌더 PC와 달라요 · 새 엔진을 받아 주세요";
  if (status.engine === "unknown") return "렌더 PC 엔진 버전을 확인하는 중이에요";
  return null;
}
