import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// 요청 2번 · 4번 (2026-11-17): pick another take of a sentence or add pause around it (no Fish), from 「음성 확인 · 수정」 wherever the video
// waits for a person; holds only at the script's sentence ends (render gate 「멈춤이 문장 중간」).
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const tools = fileURLToPath(new URL("../tools/", import.meta.url));

test("the edit helper finds a heard sentence inside the engine's joined sentence and lists that sentence's takes", () => {
  const work = mkdtempSync(path.join(os.tmpdir(), "voice-edit-"));
  try {
    writeFileSync(path.join(work, "p03_문장.json"), JSON.stringify([
      { j: 0, text: "그렇죠. 회의실 공기가 달랐어요.", take: "p03_s00_2_t.wav" },
      { j: 1, text: "남은 거예요.", take: "p03_s01_1_g.wav" }]));
    for (const name of ["p03_s01_0_t.wav", "p03_s01_1_t.wav", "p03_s01_3_t.wav", "p03_s01_1_raw.wav", "p03_s00_0_t.wav"]) writeFileSync(path.join(work, name), "");
    const out = execFileSync("python3", ["-c", `import sys, json; sys.path.insert(0, ${JSON.stringify(tools)}); import myin_voice_edit as E
rows, j = E.sentence(${JSON.stringify(work)}, 3, "회의실 공기가 달랐어요")
rows2, k = E.sentence(${JSON.stringify(work)}, 3, "남은 거예요.")
print(json.dumps([j, k, E.take_files(${JSON.stringify(work)}, 3, k), E.current(rows2, k)]))`], { encoding: "utf8" });
    assert.deepEqual(JSON.parse(out), [0, 1, [[0, "p03_s01_0_t.wav"], [1, "p03_s01_1_t.wav"], [3, "p03_s01_3_t.wav"]], 1]);
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test("take and pause fixes skip the paid plan, go back where the video was, and the render PC gets them", () => {
  const run = read("lib/server/myin-run.ts");
  assert.match(run, /const VOICE_FIX_STAGES: Record<string, MyinRun\["voiceResume"\] \| null> = \{ words_ready: null, storyboard_review: "storyboard_review", clips_review: "draft",\s*prep_ready: "prep_ready", final_ready: "prep_ready" \};/);
  assert.match(run, /const direct = memos\.filter\(\(memo\) => memo\.take \|\| memo\.pause\);/);
  assert.match(run, /const fixes = \[\.\.\.plan\.fixes, \.\.\.direct\];/);
  assert.match(run, /const stage = resume === "draft" \? "storyboard_confirmed" : resume \?\? "words_ready";/);
  assert.match(run, /if \(resume === "draft"\) await beginDraft\(service, saved, parse\(saved\)\)/);
  assert.match(run, /run\.voiceResume === "draft" \? "clips_review" : run\.voiceResume \?\? "words_ready"/, "a fix that cannot be done leaves ③ as it was");
  assert.match(run, /\.\.\.\(take \? \{ take \} : \{\}\), \.\.\.\(pause \? \{ pause \} : \{\}\)/);
  // Takes: only the render PC that made the voice has them.
  assert.match(run, /if \(run\.pc && run\.pc !== pc\) continue;/);
  assert.match(run, /code === "MYIN_TAKES_UNAVAILABLE" \? "failed" : "pending"/);
  const media = read("app/api/v1/content/youtube-automation/media/route.ts");
  for (const action of ["myin_takes_claim", "myin_takes_upload", "myin_takes_complete", "myin_takes_fail"]) assert.match(media, new RegExp(`z\\.literal\\("${action}"\\)`));
  assert.match(read("app/api/v1/content/youtube-automation/myin/route.ts"), /input\.action === "voice_takes" \? \{ run: await requestMyinTakes\(actor, input\.runId, input\.p, input\.text\) \}/);
  const worker = read("tools/youtube-media-worker.mjs");
  assert.match(worker, /if \(fix\.take \|\| fix\.pause\) \{/);
  assert.match(worker, /\[voiceEditScript, voiceJob, \.\.\.args\]/);
  assert.match(worker, /rendered \|\| processMyinWords\(\)\)\.then\(\(rendered\) => rendered \|\| processMyinTakes\(\)\)/);
  const panel = read("components/myin-voice-check.tsx");
  assert.match(panel, /const FIXABLE_AT = \["words_ready", "storyboard_review", "clips_review", "prep_ready", "final_ready"\];/);
  assert.match(panel, /pause: \{ p: line\.p, text: line\.sentence, before: 0\.2, after: 0\.2 \}/);
  assert.match(panel, /take: \{ p: data\.takes!\.p, text: data\.takes!\.text, name: file\.name \}/);
  assert.match(panel, /!check && stage === "words_ready" \?/, "the stage-1 check stays at stage 1");
});

test("a hold off a sentence end stops the preview (렌더 전 관문), and a scene pushed to a sentence end is not counted late", () => {
  assert.match(read("lib/server/myin-run.ts"), /\/못 찾음\|빈 화면\|그리기 오류\|늦게 바뀜\|초 미만 장면\|문장 중간\/\.test\(line\)/);
  const check = read("tools/myin_frame_check.py");
  assert.match(check, /sc\["t0"\] - sc\.get\("_pushed", 0\) - ta > LATE/);
  assert.match(check, /멈춤이 문장 중간: \{t\}초 — \{why\}/);
  assert.match(check, /getattr\(R, "HOLD_PROBLEMS", \[\]\)/, "an engine without it adds nothing");
  assert.match(read("lib/server/myin-storyboard-job.ts"), /멈춤\(비유 도식 장면 끝 · hold\)은 그 장면 마지막 문장 끝에서만/);
  // The voice check lists the sentences whose join the engine fixed.
  assert.match(read("lib/server/myin-run.ts"), /row\.점수 >= 0\.8 \|\| row\.긴호흡 > 0 \|\| joins\(row\)\.length/);
});
