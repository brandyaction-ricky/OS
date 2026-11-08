// 내 컴퓨터로 만들기: who may take a v13 run's step, and when a member's own computer can take one. The ③ drafts (owner decision
// 2026-10-27) and, from 2026-11-03 (직원 요청), ④ 자료 준비 with the full video are each placed on their own.

interface PlacedRun { local?: { by: string } | null; localFinish?: { by: string } | null; clipsReview?: unknown }

/** The member whose own computer takes the run's current step: ③ by `local`, ④ and the full video (drafts confirmed) by `localFinish`. */
export const localOwner = (run: PlacedRun) => (run.clipsReview ? run.localFinish : run.local)?.by;

/** The render PC (no owner) takes every step no member's computer was given; a member's computer takes only its own. */
export const placeFilter = (owner?: string) => owner
  ? (run: PlacedRun) => localOwner(run) === owner
  : (run: PlacedRun) => !localOwner(run);

/** 렌더 PC 여러 대 (2026-11-08): a render PC's claim (`pc`, its name; none from a worker that sends no name) skips a video pinned to another. */
export const pinnedElsewhere = (run: { pc?: string }, pc?: string) => Boolean(run.pc) && run.pc !== pc;

/**
 * A video pinned to another render PC waits for it. When that PC has been off for half an hour, the video moves only if its stage-1
 * voice is in the OS (the next PC rebuilds the folder from it): the step is taken here, except drafts and the full video, whose ④ files
 * stay on the PC that prepared them, so the video is prepared again first.
 */
export function movePinned(stage: string, run: { words?: { voice?: unknown } | null }, gone: boolean) {
  if (!gone || !(stage === "words_pending" || run.words?.voice)) return "wait" as const;
  return stage === "clips_pending" || stage === "final_pending" ? "prepare_again" as const : "take" as const;
}

export interface LocalRenderStatus { state: "online" | "offline" | "unknown"; ageSeconds: number | null; engine: "same" | "different" | "unknown"; job: { step: string } | null }

/** Why 내 컴퓨터 cannot take this video's drafts right now, or null when it can (`ready`: its stage 1 left the voice for staff Macs). */
export function localBlocker(status: LocalRenderStatus | null, ready = true) {
  if (!ready) return "이 영상은 영상 만드는 컴퓨터로 만들어요 · 내 컴퓨터용 음성이 없어요";
  if (!status || status.state === "unknown") return "아직 연결하지 않았어요";
  if (status.state === "offline") return "내 컴퓨터가 꺼져 있어요";
  if (status.engine === "different") return "엔진이 영상 만드는 컴퓨터와 달라요 · 새 엔진을 받아 주세요";
  if (status.engine === "unknown") return "영상 만드는 컴퓨터 엔진 버전을 확인하는 중이에요";
  return null;
}
