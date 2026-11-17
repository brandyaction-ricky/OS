// 이번 수정 확인 (유쓰 요청 d06d8afe): the earlier comments a version actually fixed, at their place in that version.
import { mapTime, type Anchor } from "./compare.ts";
import { feedbackNotice } from "./feedback.ts";

type Item = { target: string; status: string; deleted?: boolean; reaction?: boolean; fixedIn: number | null; ver: number; kind: string; text: string; t: number | null; range: [number, number] | null };

/** Comments from earlier versions marked 반영됨 in `ver` (the editor marks them when it confirms a version; a person's ✓ marks the latest one). */
export function fixedInVersion<T extends Item>(items: T[], ver: number): T[] {
  return items.filter(item => item.target === "video" && item.status === "done" && !item.deleted && !item.reaction && item.fixedIn === ver && item.ver < ver && !feedbackNotice(item))
    .sort((a, b) => a.ver - b.ver || (a.t ?? a.range?.[0] ?? 0) - (b.t ?? b.range?.[0] ?? 0));
}

/** Where an old time is in the new version: by the lines both versions' subtitles share (a cut scene lands where the video continues).
 *  Without shared lines the old time is only a guess, so it is marked 위치 확인 필요. */
export function fixedSpot(oldTime: number, anchors: Anchor[] | null | undefined, duration = 0): { at: number; sure: boolean } {
  return anchors?.length ? { at: mapTime(oldTime, anchors, 0, duration), sure: true } : { at: oldTime, sure: false };
}
