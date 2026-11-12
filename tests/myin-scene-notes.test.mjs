import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sceneNow, sceneNoteState, sceneRequestNote } from "../lib/myin-scene-notes.ts";

// 점검 시트 장면 의견 (직원 요청 2026-11-12).
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const pin = { runId: "r", n: 7, at: "괜찮다고 답하죠", type: "photo", storyboardAt: "2026-11-12T01:00:00.000Z", sheetsAt: "s" };
const scenes = (ats) => ats.map((at) => ({ at }));

test("a note keeps its scene: same storyboard by number, a new one by its 시작 문구 nearest to where it was, else 「장면 못 찾음」", () => {
  assert.equal(sceneNow(pin, scenes(Array(12).fill("x")), pin.storyboardAt), 7);
  assert.equal(sceneNow(pin, scenes(["a"]), pin.storyboardAt), null);
  const moved = scenes(["a", "괜찮다고 답하죠", "b", "c", "d", "e", "f", "g", "괜찮다고 답하죠"]);
  assert.equal(sceneNow(pin, moved, "2026-11-12T02:00:00.000Z"), 9);
  assert.equal(sceneNow(pin, scenes(["a", "b"]), "2026-11-12T02:00:00.000Z"), null);
});

test("대기 → 내 AI가 고치는 중 → 확인 필요 (a storyboard came back after it was sent) → 반영 완료 · 반영 안 함", () => {
  const note = { scene: pin, status: "open", deleted: false, sent: null };
  assert.equal(sceneNoteState(note, pin.storyboardAt), "waiting");
  const sent = { ...note, sent: { at: "2026-11-12T03:00:00.000Z" } };
  assert.equal(sceneNoteState(sent, pin.storyboardAt), "fixing");
  assert.equal(sceneNoteState(sent, "2026-11-12T03:20:00.000Z"), "check");
  assert.equal(sceneNoteState({ ...sent, status: "done" }, "2026-11-12T03:20:00.000Z"), "done");
  assert.equal(sceneNoteState({ ...note, status: "declined" }, pin.storyboardAt), "declined");
});

test("the 수정 요청 line names each scene and stays within the review note's 2,000 letters", () => {
  const line = sceneRequestNote([{ n: 3, who: "PD", text: "글자가\n칸을 넘어요" }]);
  assert.match(line, /^점검 시트 장면 의견 1개/);
  assert.match(line, /- #3 PD: 글자가 칸을 넘어요/);
  assert.ok(sceneRequestNote(Array.from({ length: 20 }, (_, i) => ({ n: i + 1, who: "편집자", text: "가".repeat(500) }))).length <= 2000);
});

test("장면 의견 never show in the 최종 검토 list, the editor's orders or its feedback states", () => {
  const feedback = read("lib/server/youtube-process-feedback.ts");
  assert.match(feedback, /filter\(item => \(item\.target === "scene"\) === scenes\)/);
  assert.match(feedback, /export async function listFeedback\(actor: RequestActor, id: string, scenes = false\)/);
  // A scene note is written while the video is made (③), pinned to a scene the server reads from the storyboard on the sheets.
  assert.match(feedback, /if \(!scene && !\["review", "upload"\]\.includes\(project\.yp\.stage\)\)/);
  const pinCode = read("lib/server/myin-scene-notes.ts");
  assert.match(pinCode, /run\.storyboard\.at !== input\.storyboardAt/);
});

test("sending goes through the existing 수정 요청 and the staff AI gets the notes with the storyboard they were written on", () => {
  const send = read("lib/server/myin-scene-notes.ts");
  const body = send.slice(send.indexOf("export async function sendSceneNotes"));
  assert.ok(body.indexOf("reviewMyinStoryboard(") < body.indexOf("sent }"), "notes are marked sent only after the 수정 요청 holds");
  const card = read("lib/server/myin-storyboard-job.ts");
  assert.match(card, /위 장면만 고치고 다른 장면 · cta · music_cues · assets는 그대로 둡니다/);
  assert.equal(card.match(/\$\{sceneNotesSection\(input\.sceneNotes\)\}/g)?.length, 2, "long and short cards both carry the notes");
  const jobs = read("lib/server/youtube-ai-jobs.ts");
  assert.match(jobs, /note: sceneNotes \? undefined : note, sceneNotes/);
  // The panel sends the 수정 요청 and then the storyboard job to the person's own AI, as [수정 요청] + [내 AI에 보내기] do.
  const panel = read("components/myin-v13-panel.tsx");
  assert.match(panel, /action: "scene_notes", runId: run\.id, ids \}\); await post\("\/ai-jobs", "POST", \{ task: "storyboard", sourceId \}\)/);
});
