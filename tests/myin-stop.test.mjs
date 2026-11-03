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

// 2026-11-03: ④ stopped inside Logan's engine (FileNotFoundError) on ours_ photos nobody uploaded; the OS names them before drawing.
test("an ours_ photo nobody uploaded stops ④ by name, and uploading it starts again", async () => {
  assert.match(myinStop("MYIN_OUR_IMAGE_NEEDED").next, /저절로 다시 시작/);
  const run = await readFile(new URL("../lib/server/myin-run.ts", import.meta.url), "utf8");
  const claim = run.slice(run.indexOf("export async function claimMyinPrep"), run.indexOf("/** Render PC: the preview ran."));
  assert.match(claim, /draft \? \[\] : photoSources\(run, folders\)\.filter\(\(photo\) => photo\.from === "none" && photo\.file\.startsWith\("ours_"\)\)/);
  assert.match(claim, /failed\(service, record, run, "MYIN_OUR_IMAGE_NEEDED", waiting\)/);
  assert.match(run, /code === "MYIN_OUR_IMAGE_NEEDED" \|\|/, "blocked at once, not tried three times");
});
