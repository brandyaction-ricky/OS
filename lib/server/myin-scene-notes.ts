import { z } from "zod";
import { ApiError } from "@/lib/http";
import { sceneNow, sceneRequestNote, type SceneNotePin } from "@/lib/myin-scene-notes";
import type { OsRecord } from "@/lib/record-types";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { RequestActor } from "./auth";
import { reviewMyinStoryboard, storyboardJson, visibleRun } from "./myin-run";

// 점검 시트 장면 의견 (직원 요청 2026-11-12): a note is a content_feedback item with target "scene" (the 최종 검토 list leaves
// these out). Chosen notes go to the requester's own AI as the existing 수정 요청 — the storyboard comes back to 확인 and ③ draws
// again; nothing is confirmed or drawn by the note itself.

export const sceneNoteInput = z.object({ runId: z.string().uuid(), n: z.number().int().min(1).max(400), storyboardAt: z.string().max(40) }).strict();

/** Where a new note goes: the scene as the storyboard the sheets were drawn from has it (sheets from an older storyboard are refused). */
export async function sceneNotePin(actor: RequestActor, projectId: string, input: z.infer<typeof sceneNoteInput>): Promise<SceneNotePin> {
  const { run } = await visibleRun(actor, input.runId);
  if (run.sourceId !== projectId) throw new ApiError(404, "MYIN_RUN_NOT_FOUND", "이 영상의 작업이 아니에요.");
  if (!run.storyboard || !run.prepared?.sheets.length) throw new ApiError(409, "SCENE_SHEETS_MISSING", "점검 시트가 나온 뒤에 장면 의견을 남겨요.");
  if (run.storyboard.at !== input.storyboardAt) throw new ApiError(409, "SCENE_STORYBOARD_CHANGED", "기획표가 바뀌었어요. 점검 시트를 다시 열어 주세요.");
  const scene = (await storyboardJson(createServiceSupabase(), run)).scenes[input.n - 1];
  if (!scene) throw new ApiError(400, "SCENE_NOT_FOUND", `#${input.n} 장면이 기획표에 없어요.`);
  return { runId: input.runId, n: input.n, at: String(scene.at ?? ""), type: String(scene.type ?? ""), storyboardAt: run.storyboard.at, sheetsAt: run.prepared.at };
}

type NoteMeta = { target?: string; scene?: SceneNotePin; status?: string; deleted?: boolean; who?: string };

/** 내 AI에 수정 요청: the chosen open notes become one 수정 요청 naming their scenes in the storyboard now; each note is marked sent. */
export async function sendSceneNotes(actor: RequestActor, runId: string, ids: string[]) {
  const { record, run } = await visibleRun(actor, runId);
  const { data, error } = await actor.supabase.from("os_records").select("*").in("id", ids).eq("parent_id", run.sourceId)
    .eq("record_type", "content_feedback").is("archived_at", null);
  if (error) throw new ApiError(500, "SCENE_NOTES_READ_FAILED", "장면 의견을 읽지 못했어요.");
  const rows = ((data ?? []) as OsRecord[]).filter((row) => {
    const m = row.metadata as NoteMeta;
    return m.target === "scene" && m.scene?.runId === record.id && m.status === "open" && !m.deleted && row.description.trim();
  });
  if (rows.length !== ids.length) throw new ApiError(409, "SCENE_NOTES_CHANGED", "고른 의견 중 지워졌거나 처리된 것이 있어요. 목록을 다시 열어 주세요.");
  if (!run.storyboard) throw new ApiError(409, "MYIN_STORYBOARD_MISSING", "기획표가 나온 뒤에 보낼 수 있어요.");
  const scenes = (await storyboardJson(createServiceSupabase(), run)).scenes.map((scene) => ({ at: String(scene.at ?? ""), type: String(scene.type ?? "") }));
  const items = rows.map((row) => {
    const m = row.metadata as NoteMeta & { scene: SceneNotePin };
    const n = sceneNow(m.scene, scenes, run.storyboard!.at);
    if (!n) throw new ApiError(409, "SCENE_NOTE_LOST", `「${row.description.slice(0, 30)}」 의견의 장면을 지금 기획표에서 찾지 못했어요. 그 의견을 다시 확인해 주세요.`);
    return { row, n, at: scenes[n - 1].at, type: scenes[n - 1].type, who: String(m.who ?? ""), text: row.description.trim() };
  }).sort((a, b) => a.n - b.n);
  const saved = await reviewMyinStoryboard(actor, runId, "revise", sceneRequestNote(items), undefined, undefined,
    items.map(({ n, at, type, who, text }) => ({ n, at, type, who, text })));
  // Marked after the 수정 요청 holds: a note the stage refused stays 대기. A note changed meanwhile (version) keeps its own state.
  const sent = { at: saved.review?.at ?? new Date().toISOString(), by: actor.id, name: actor.name };
  await Promise.all(items.map(({ row }) => actor.supabase.from("os_records").update({ metadata: { ...(row.metadata as object), sent }, updated_by: actor.id })
    .eq("id", row.id).eq("version", row.version)));
  return saved;
}
