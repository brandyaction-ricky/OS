import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// 한 문장 고치기 ②: only a voice whose paragraphs all stay where the drawn video has them is mixed over that picture.
test("sameTimes keeps the drawn video only when every paragraph stays in place", async () => {
  const { sameTimes } = await import(`../tools/youtube-media-worker.mjs?patch=${Date.now()}`);
  const before = { total: 30.5, paragraphs: [{ i: 0, start: 0, dur: 10.2 }, { i: 1, start: 10.9, dur: 19.6 }] };
  assert.equal(sameTimes(before, structuredClone(before)), true);
  assert.equal(sameTimes(before, { total: 30.52, paragraphs: [{ i: 0, start: 0, dur: 10.21 }, { i: 1, start: 10.92, dur: 19.6 }] }), true);
  assert.equal(sameTimes(before, { total: 30.9, paragraphs: [{ i: 0, start: 0, dur: 10.6 }, { i: 1, start: 11.3, dur: 19.6 }] }), false);
  assert.equal(sameTimes(before, { total: 30.5, paragraphs: [{ i: 0, start: 0, dur: 30.5 }] }), false);
  assert.equal(sameTimes(undefined, before), false);
});

test("a fix asked on the finished video goes to the render PC as a sound-only final and comes back to ⑤", () => {
  const server = readFileSync(new URL("../lib/server/myin-run.ts", import.meta.url), "utf8");
  assert.match(server, /const patch = record\.stage === "final_ready" && Boolean\(run\.final\) && !run\.layout && run\.renderer !== "web";/);
  assert.match(server, /run\.voicePatch && run\.final && !owner \? \{ patch: \{ videoUploadUrl:/);
  assert.match(server, /const patched = run\.voicePatch && run\.final \? input\.patched : undefined;/);
  assert.match(server, /retireFinal\(next\);\n    next\.final = \{ \.\.\.run\.final!, video: finalFiles\(record, run, input\.lease\)\.video, \.\.\.patched,/);
  assert.match(server, /delete next\.voiceResume; delete next\.voicePatch;\n    await save\(service, record, "done", run\.voiceResume === "draft"/);
  const worker = readFileSync(new URL("../tools/youtube-media-worker.mjs", import.meta.url), "utf8");
  assert.match(worker, /patch = Boolean\(job\.patch\) && defer && !fixes\.some\(\(fix\) => fix\.pause\)/);
  assert.match(worker, /if \(patch\) patch = await fitParagraphSounds\(speaker, voiceDir, env\);\n.*\n      if \(deferred \|\| patch\) await runAsync/);
});

// 한 문장 고치기 ③: the held-high crack check (calibrated by ear) adds to the pause check's list, which the OS voices again by itself.
test("the crack check runs after the pause check on the same list, with the owner-calibrated thresholds", () => {
  const worker = readFileSync(new URL("../tools/youtube-media-worker.mjs", import.meta.url), "utf8");
  assert.match(worker, /\[pauseScript, voiceDir, file\][^\n]*\n.*\n      if \(process\.env\.MYIN_CRACK_CHECK !== "off"\) await runOut\(myinPython, \[crackScript, voiceDir, file\]\);/);
  const check = readFileSync(new URL("../tools/myin_crack_check.py", import.meta.url), "utf8");
  assert.match(check, /^HIGH, RUN, PEAK_LO, PEAK_HI, AGREE = 1\.9, 8, 2\.1, 2\.6, 0\.8$/m);
  assert.match(check, /"kind": "음이탈"/);
});
