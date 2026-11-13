import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sameNotes, sceneNow, sceneNoteState, sceneWords, spliceScene } from "../lib/myin-scene-notes.ts";

// 점검 시트 장면 의견 (직원 요청 2026-11-12) and its follow-up: a 수정안 per scene, applied one by one while the sheets stay open.
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

test("대기 → 고치는 중 (its job open) → 확인 필요 (a 수정안 came) → 반영 완료; a job that closed without one leaves 「못 받음」", () => {
  const note = { scene: pin, status: "open", deleted: false, sent: null, proposal: null };
  assert.equal(sceneNoteState(note, pin.storyboardAt), "waiting");
  const sent = { ...note, sent: { at: "2026-11-12T03:00:00.000Z", jobId: "j1" } };
  assert.equal(sceneNoteState(sent, "2026-11-12T09:00:00.000Z"), "fixing", "another 반영 meanwhile does not make it 확인 필요");
  assert.equal(sceneNoteState(sent, pin.storyboardAt, new Set(["j1"])), "failed");
  assert.equal(sceneNoteState({ ...sent, proposal: { scenes: [] } }, pin.storyboardAt), "check");
  assert.equal(sceneNoteState({ ...sent, status: "done" }, pin.storyboardAt), "done");
  // Sent the first way (one 수정 요청, no job id): 확인 필요 once a storyboard came back after it.
  assert.equal(sceneNoteState({ ...note, sent: { at: "2026-11-12T03:00:00.000Z" } }, "2026-11-12T03:20:00.000Z"), "check");
});

test("a 수정안 replaces only its scene (it may split it), and reads as words for 수정 전 · 후", () => {
  const story = { scenes: [{ at: "a" }, { at: "b", type: "lib_question_typing", q: { text: "그날, 뭐가 달랐다면?", cue: "b" }, button: "떠올리기" }, { at: "c" }] };
  const next = spliceScene(story, 2, [{ at: "b", type: "text" }, { at: "b2", type: "text" }]);
  assert.deepEqual(next.scenes.map((scene) => scene.at), ["a", "b", "b2", "c"]);
  assert.equal(story.scenes.length, 3, "the storyboard it came from is untouched");
  assert.equal(sceneWords(story.scenes[1]), "lib_question_typing · 그날, 뭐가 달랐다면? / 떠올리기");
});

test("장면 의견 never show in the 최종 검토 list, the editor's orders or its feedback states", () => {
  const feedback = read("lib/server/youtube-process-feedback.ts");
  assert.match(feedback, /filter\(item => \(item\.target === "scene"\) === scenes\)/);
  assert.match(feedback, /if \(!scene && !\["review", "upload"\]\.includes\(project\.yp\.stage\)\)/);
  // Notes are pinned to the sheets as drawn, which keep showing the older storyboard after a 반영.
  const notes = read("lib/server/myin-scene-notes.ts");
  assert.match(notes, /const story = await sheetsStory\(createServiceSupabase\(\), run\);/);
});

test("scene-notes jobs wait in turn, a 수정안 is checked like a storyboard and saved beside its note, and 반영 asks when the scene moved on", () => {
  const jobs = read("lib/server/youtube-ai-jobs.ts");
  assert.match(jobs, /if \(input\.task === "scene-notes"\) \{\n      if \(\(meta\(job\)\.noteIds \?\? \[\]\)\.some\(\(id\) => input\.notes\.includes\(id\)\)\) throw[^\n]+\n      continue;/);
  assert.match(jobs, /"SCENE_NOTE_IN_JOB"/);
  const notes = read("lib/server/myin-scene-notes.ts");
  const save = notes.slice(notes.indexOf("export async function saveSceneNotes"), notes.indexOf("export async function applySceneNote"));
  assert.match(save, /checkedSplice\(story, note\.n, fix\.scenes/);
  assert.doesNotMatch(save, /saveMyinSceneEdit/, "a 수정안 does not touch the storyboard");
  const apply = notes.slice(notes.indexOf("export async function applySceneNote"));
  assert.match(apply, /\["storyboard_review", "clips_review"\]\.includes\(record\.stage \?\? ""\) \|\| run\.clipsReview/);
  assert.match(apply, /if \(!force && JSON\.stringify\(story\.scenes\[n - 1\]\) !== JSON\.stringify\(proposal\.base\.scene\)\)/);
  const run = read("lib/server/myin-run.ts");
  assert.match(run, /storyboardPath: run\.storyboard!\.path/);
});

test("여러 장면에 같은 의견 (11-13): the same words read as one comment, in scene order, and go to 내 AI once with their scenes", () => {
  const notes = [{ id: "c", n: 4, text: "강조 자막을 줄이고  이미지 위주로" }, { id: "a", n: 1, text: "강조 자막을 줄이고 이미지 위주로" }, { id: "b", n: 2, text: "다른 의견" }];
  assert.deepEqual(sameNotes(notes).map((group) => group.map((note) => note.id)), [["a", "c"], ["b"]]);
  const card = read("lib/server/myin-scene-notes.ts");
  assert.match(card, /\$\{sameNotes\(input\.notes\)\.map\(\(group\) => `- 의견: \$\{group\[0\]\.text\}/);
  assert.match(card, /\.min\(1\)\.max\(20\) \}\)\.strict\(\);/);
  assert.match(read("lib/server/youtube-ai-jobs.ts"), /task: z\.literal\("scene-notes"\), sourceId: z\.string\(\)\.uuid\(\), notes: z\.array\(z\.string\(\)\.uuid\(\)\)\.min\(1\)\.max\(20\)/);
  // Each picked scene keeps its own note (its own state and 수정안); the list folds the same words into one line.
  const screen = read("components/myin-scene-notes.tsx");
  assert.match(screen, /for \(const n of order\) ids\.push\(/);
  assert.match(screen, /group\.length === 1 \? listRow\(group\[0\]\) :/);
});
