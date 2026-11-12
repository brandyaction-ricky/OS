// 점검 시트 장면 의견 (직원 요청 2026-11-12): a note under one scene of the ③ 점검 시트, kept as a feedback item pinned to
// that scene of that storyboard. Shared by the server (sending to 내 AI) and the ③ panel (where each note shows now).

/** The scene a note was written on: its number, 시작 문구 (at) and kind in the storyboard the sheets were drawn from. */
export interface SceneNotePin { runId: string; n: number; at: string; type: string; storyboardAt: string; sheetsAt: string }
export interface SceneNoteLike { scene: SceneNotePin | null; status: string; deleted: boolean; sent: { at: string } | null }

/**
 * The scene number a note means in the storyboard now: the same number on the same storyboard; after a 수정 the scene with the
 * same 시작 문구 nearest to where it was (scenes can split or move); null when no scene starts there any more — the person looks again.
 */
export function sceneNow(pin: SceneNotePin, scenes: { at: string }[], storyboardAt: string): number | null {
  if (pin.storyboardAt === storyboardAt) return pin.n <= scenes.length ? pin.n : null;
  if (!pin.at) return null;
  const hits = scenes.flatMap((scene, i) => scene.at === pin.at ? [i + 1] : []);
  return hits.length ? hits.reduce((best, n) => Math.abs(n - pin.n) < Math.abs(best - pin.n) ? n : best) : null;
}

/** 대기 · 내 AI가 고치는 중 · 확인 필요 (a storyboard came back after it was sent) · 반영 완료 · 반영 안 함. */
export type SceneNoteState = "waiting" | "fixing" | "check" | "done" | "declined";
export function sceneNoteState(note: SceneNoteLike, storyboardAt: string): SceneNoteState {
  if (note.status === "done") return "done";
  if (note.status === "declined") return "declined";
  if (!note.sent) return "waiting";
  return storyboardAt > note.sent.at ? "check" : "fixing";
}
export const SCENE_NOTE_STATE: Record<SceneNoteState, string> = { waiting: "대기", fixing: "내 AI가 고치는 중", check: "확인 필요", done: "반영 완료", declined: "반영 안 함" };

/** The 수정 요청 line the ③ panel shows (the full notes go to 내 AI beside it). */
export function sceneRequestNote(items: { n: number; who: string; text: string }[]) {
  const lines = items.map((item) => `- #${item.n} ${item.who}: ${item.text.replace(/\s+/g, " ")}`);
  return `점검 시트 장면 의견 ${items.length}개 — 이 장면만 고쳐요.\n${lines.join("\n")}`.slice(0, 2000);
}
