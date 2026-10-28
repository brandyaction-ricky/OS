// 영상 복제 (owner decision 2026-10-28, 「같은 단계 그대로」): the topic, 기획안, 구성안 원고, the 제작 schedule and thumbnails and the
// 주제 · 기획안 컨펌 come along, and the copy carries on from the same step. Voice and video are made again, so a project past 제작
// lands on 제작 and the 최종 검토 · 쇼츠 컨펌 start over.
import { emptyGates, type YpMeta, type YpStage } from "./project.ts";
import type { YpMake } from "./stages";

const AFTER_MAKE: YpStage[] = ["review", "upload", "shorts", "done"];
/** The step records a copy takes; 업로드 · SEO 칼럼 · 숏폼 주제 후보 come after the video. */
export const COPIED_STAGES = ["plan", "outline", "make", "shortScript"] as const;

/** The copy's project meta: same step (제작 at most), the 주제 · 기획안 컨펌 kept, everything after the video left behind. */
export function copiedMeta(yp: YpMeta, now: string): YpMeta {
  const kept = { ...yp };
  delete kept.shortsConfirmed; delete kept.shortsLog;
  return { ...kept, stage: AFTER_MAKE.includes(yp.stage) ? "make" : yp.stage, gates: { ...emptyGates(), topic: yp.gates.topic, draft: yp.gates.draft }, contentUpdatedAt: now };
}

/** 제작 without its video: the finals uploaded by hand and the production status start over; schedule and thumbnails stay. */
export const copiedMake = (make: YpMake): YpMake => ({ ...make, status: "prep", statusAt: {}, log: [], finals: [] });
