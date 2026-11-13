// 점검 시트 장면 의견 (직원 요청 2026-11-12): a note under one scene of the ③ 점검 시트, kept as a feedback item pinned to
// that scene of that storyboard. Shared by the server (내 AI 수정안 · 반영) and the ③ panel (where each note shows now).

/** The scene a note was written on: its number, 시작 문구 (at) and kind in the storyboard the sheets were drawn from. */
export interface SceneNotePin { runId: string; n: number; at: string; type: string; storyboardAt: string; sheetsAt: string }

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

/** A 수정안: the scenes the AI wrote in place of the noted one, on the storyboard as it was then (base), kept beside the note. */
export interface SceneProposal { scenes: Record<string, unknown>[]; why: string; by: string; model: string; at: string; jobId: string;
  base: { storyboardAt: string; n: number; scene: Record<string, unknown> } }
export interface SceneNoteLike { scene: SceneNotePin | null; status: string; deleted: boolean; sent: { at: string; jobId?: string } | null; proposal?: SceneProposal | null }

/**
 * 대기 · 내 AI가 고치는 중 · 확인 필요 (a 수정안 came, or — notes sent the 11-12 way — a storyboard came back after) · 반영 완료 ·
 * 반영 안 함 · 못 받음 (the job it went with closed without a 수정안: send again).
 */
export type SceneNoteState = "waiting" | "fixing" | "check" | "done" | "declined" | "failed";
export function sceneNoteState(note: SceneNoteLike, storyboardAt: string, closedJobs: ReadonlySet<string> = new Set()): SceneNoteState {
  if (note.status === "done") return "done";
  if (note.status === "declined") return "declined";
  if (note.proposal) return "check";
  if (!note.sent) return "waiting";
  if (note.sent.jobId) return closedJobs.has(note.sent.jobId) ? "failed" : "fixing";
  return storyboardAt > note.sent.at ? "check" : "fixing";
}
export const SCENE_NOTE_STATE: Record<SceneNoteState, string> = { waiting: "대기", fixing: "내 AI가 고치는 중", check: "확인 필요", done: "반영 완료", declined: "반영 안 함", failed: "못 받음 · 다시 보내기" };

/** The storyboard with scene n (1-based) replaced by the given scenes (a 수정안 may split one scene); the input is not changed. */
export function spliceScene<T extends { scenes: Record<string, unknown>[] }>(story: T, n: number, scenes: Record<string, unknown>[]): T {
  const copy = structuredClone(story);
  copy.scenes.splice(n - 1, 1, ...structuredClone(scenes));
  return copy;
}

const SKIP = new Set(["type", "theme", "mood", "beat", "why", "at", "music", "amb", "sfx", "photo", "focus_y", "focus_x", "fit", "cam"]);
/** A scene as a person reads it: its kind and the words it shows (cue keys and settings left out), for 수정 전 · 후 side by side. */
export function sceneWords(scene: Record<string, unknown>) {
  const out: string[] = [];
  const walk = (value: unknown, key = ""): void => {
    if (key.startsWith("cue") || key.startsWith("_") || SKIP.has(key)) return;
    if (typeof value === "string") { if (value.trim()) out.push(value.trim()); }
    else if (Array.isArray(value)) value.forEach((item) => walk(item));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, k);
  };
  walk(scene);
  return `${String(scene.type ?? "")} · ${out.join(" / ")}`.slice(0, 400);
}

/** One comment written for several scenes reads as one: notes with the same words (spacing aside). */
export const noteKey = (text: string) => text.replace(/\s+/g, " ").trim();
/** Notes grouped by their words, each group in scene order, groups in order of their first scene. */
export function sameNotes<T extends { text: string; n: number }>(notes: T[]) {
  const groups = new Map<string, T[]>();
  for (const note of [...notes].sort((a, b) => a.n - b.n)) groups.set(noteKey(note.text), [...(groups.get(noteKey(note.text)) ?? []), note]);
  return [...groups.values()];
}

/** Each 점검 시트 cell's storyboard number: the drawing's (an opening's acts are several cells, all #1; 직원 요청 11-13), else the cell's
 *  place, as his preview() laid one cell per scene of his own (3 × 4 a sheet). */
export const sheetCells = (sheets: { cells: number[] | null; scenes: unknown[]; urls: unknown[] }) =>
  sheets.cells ?? Array.from({ length: Math.min(sheets.scenes.length || sheets.urls.length * 12, sheets.urls.length * 12) }, (_, i) => i + 1);
