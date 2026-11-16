import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { myinRetryScope, myinStop } from "../lib/myin-stop.ts";

// 유쓰 요청 3/8 (2026-11-02): a stopped v13 run says why, whether pressing again can help, and what 다시 하기 redoes and keeps.
test("every stop says why and what next; an unknown one is 확인 필요", () => {
  assert.match(myinStop("WORKER_UPLOAD_NETWORK").next, /이어서/);
  assert.match(myinStop("WORKER_STAGE_FAILED").next, /전에 OS 담당자/);
  assert.match(myinStop("SOMETHING_NEW").why, /확인 필요/);
  assert.match(myinStop(null).why, /확인 필요/);
});

test("다시 하기 names the step it redoes and what it keeps", () => {
  assert.match(myinRetryScope({ stage: "final_pending" }), /전체 영상 합치기만/);
  assert.match(myinRetryScope({ stage: "clips_pending", prepared: {} }), /미리보기 영상만/);
  assert.match(myinRetryScope({ stage: "clips_pending" }), /미리보기 준비부터/);
  assert.match(myinRetryScope({ stage: "prep_pending", clipsReview: {} }), /4단계 자료 준비부터/);
  assert.match(myinRetryScope({ stage: "words_pending" }), /이어 써요/);
});

test("a stop at the clips keeps the finished preparation", async () => {
  const run = await readFile(new URL("../lib/server/myin-run.ts", import.meta.url), "utf8");
  const start = run.slice(run.indexOf("export async function startMyinPrep"), run.indexOf("/** One CTA line of voice per call"));
  assert.match(start, /record\.stage === "clips_pending" && run\.prepared && !run\.clipsReview[\s\S]*"clips_pending"/);
  assert.match(start, /await assertCurrent\(/, "a changed 원고 still stops it (a new run instead)");
});

// 2026-11-03: ④ stopped inside Logan's engine (FileNotFoundError) on ours_ photos nobody uploaded; the OS then stopped ④ by name.
// 로건 11-13: go on to the end with a gray 「사진 자리」 for each and list them as 바꿀 사진; uploading one prepares ④ again.
test("an ours_ photo nobody uploaded goes in as a placeholder at ④ and is listed to replace", async () => {
  assert.match(myinStop("MYIN_OUR_IMAGE_NEEDED").next, /저절로 다시 시작/, "older runs stopped this way still read");
  const run = await readFile(new URL("../lib/server/myin-run.ts", import.meta.url), "utf8");
  const claim = run.slice(run.indexOf("export async function claimMyinPrep"), run.indexOf("/** Render PC: the preview ran."));
  assert.match(run, /const ourStandIns = \(run: MyinRun, folders: Map<string, string\[\]>\) => photoSources\(run, folders\)\.filter\(\(photo\) => photo\.from === "none" && photo\.file\.startsWith\("ours_"\)\)/);
  assert.match(claim, /const standIns = draft \? \[\] : ourStandIns\(run, folders\);/);
  assert.match(claim, /const placeholders = \[\.\.\.folders\]\.filter\(\(\[file\]\) => draft \|\| standIns\.includes\(file\)\)/, "the worker draws 사진 자리 for exactly these at ④");
  assert.doesNotMatch(claim, /MYIN_OUR_IMAGE_NEEDED/, "④ no longer stops for them");
  assert.match(run, /if \(!draft\) \{ const standIns = ourStandIns\(run, myinPhotoFolders\(await storyboardJson\(service, run\)\)\); if \(standIns\.length\) next\.prepared!\.standIns = standIns\.slice\(0, 60\); \}/);
  assert.match(run, /standIns: \(run\.prepared\.standIns \?\? \[\]\)\.filter\(\(file\) => !run\.ours\?\.\[file\]\)/, "an uploaded one leaves the list");
  const panel = await readFile(new URL("../components/myin-v13-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /바꿀 사진 \{standIns\.length\}장 · 회색 「사진 자리」로 들어갔어요/);
});

// 로건 11-13: after v1 the finished step folded to one line, and the editor card left with v0; both stay now.
test("the finished video stays open in 5단계 and the editor card stays after v1", async () => {
  const steps = await readFile(new URL("../components/youtube-production-steps.tsx", import.meta.url), "utf8");
  assert.match(steps, /\{state === "done" && !open \? <details className="panel-pad-lg yt-step-fold">/);
  const panel = await readFile(new URL("../components/myin-v13-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /<Step index=\{4\} state=\{step5\} title=\{short \? "완성 영상" : "완성 영상과 자료 확인"\} idBase="myin-step" open>/);
  const entry = await readFile(new URL("../components/editor-screen.tsx", import.meta.url), "utf8");
  assert.match(entry, /\(!screen\.versions\.length && !screen\.lock && !finals\)\) return null;/);
});
