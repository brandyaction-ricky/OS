import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { carriedScreens } from "../lib/youtube-screen-check.ts";

// 요청 3번 나머지 (2026-11-17): after a voice change only the changed paragraphs are heard and checked again, and a new ③ draws and
// checks only the scenes that differ from the sheets the video had.
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const tools = fileURLToPath(new URL("../tools/", import.meta.url));
const py = (code) => JSON.parse(execFileSync("python3", ["-c", `import sys, json; sys.path.insert(0, ${JSON.stringify(tools)})\n${code}`], { encoding: "utf8" }));

test("a paragraph with the same sound keeps its words, moved by where its sound sits; the rest is heard again in runs", () => {
  const out = py(`import myin_words as W
ps = [{"at": 0.0, "dur": 4.0}, {"at": 4.6, "dur": 3.0}, {"at": 8.2, "dur": 2.0}]
b = W.bounds(ps)
words = [[0.1, 0.5, "가"], [3.9, 4.25, "나"], [4.7, 5.0, "다"], [8.3, 8.6, "라"]]
print(json.dumps([W.match(["a", "b", "c", "d"], ["a", "x", "c", "d", "y"]), W.runs(5, {0: 0, 2: 2, 3: 3}), [round(x, 2) for x in b[1:-1]],
  [w[2] for w in W.inside(words, b[1], b[2])]]))`);
  assert.deepEqual(out[0], { 0: 0, 2: 2, 3: 3 }, "same sounds in order");
  assert.deepEqual(out[1], [[1, 1], [4, 4]], "the others, heard again together where they touch");
  assert.deepEqual(out[2], [4.3, 7.9], "each span ends in the middle of the pause after it");
  assert.deepEqual(out[3], ["다"], "a word belongs to the paragraph its middle falls in (「나」 ends the one before)");
  const source = read("tools/myin_words.py");
  assert.match(source, /shift = ps\[i\]\["at"\] - before\["paragraphs"\]\[k\]\["at"\]/, "moved by the sound, not by his timings (they drifted 0.21 s)");
  assert.match(source, /WhisperModel\("small", device="cpu", compute_type="int8"\)/, "his stage_words' model");
  assert.match(source, /max\(abs\(p\["at"\] - p\["start"\]\) for p in ps\) <= DRIFT_MOST/, "a check cut by drifted timings is made again");
  assert.match(source, /os\.path\.getmtime\(words_file\) < os\.path\.getmtime\(voice\)/, "words older than the voice are not kept");
});

test("the render PC remembers the voice before a fix or the earlier run's, and falls back to his tools", () => {
  const worker = read("tools/youtube-media-worker.mjs");
  assert.match(worker, /current\.step = "voice fix";\n\s*await runOut\(myinPython, \[wordsScript, "snap", voiceDir, out, before\]\);/, "before the fixes change it");
  assert.match(worker, /if \(donor\) await runOut\(myinPython, \[wordsScript, "snap", path\.join\(donor, "voice", "os_voice"\), path\.join\(donor, "voice", "os_myin"\), before\]\);/);
  assert.match(worker, /const result = some \? \{ ok: true \} : await runOut\(speaker\.python, \["voice_audit\.py", voiceDir, file\]/);
  assert.match(worker, /if \(!heard\) await runAsync\(myinPython, \["stage_words\.py", voiceJob, videoJob\]/);
  assert.match(worker, /rmSync\(before, \{ force: true \}\);/, "a snapshot never outlives its voice");
});

test("the frame check skips kept scenes and brings their blank-screen lines under their numbers now", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "frame-keep-"));
  try {
    writeFileSync(path.join(dir, "redraw.json"), JSON.stringify({ keep: { 0: 0, 2: 3 }, kept: [[1, 1], [3, 4]] }));
    writeFileSync(path.join(dir, "lines.json"), JSON.stringify(["[장면 4] 빈 화면: 50.1초", "[장면 2] 그리기 오류: 9초 (x)", "[장면 4] 말보다 화면이 늦게 바뀜: x"]));
    const out = py(`import myin_frame_check as F
skip, lines = F.carried(${JSON.stringify(path.join(dir, "redraw.json"))}, ${JSON.stringify(path.join(dir, "lines.json"))})
print(json.dumps([sorted(skip), lines]))`);
    assert.deepEqual(out, [[0, 2], ["[장면 3] 빈 화면: 50.1초"]], "a drawn scene's and a time check's lines are not carried");
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.match(read("tools/myin_redraw.py"), /"kept": \[\[n, o\] for n, o in sorted\(kept\.items\(\)\)\]/);
});

test("GPT sees only the sheets with a scene drawn again; the stored lines of kept scenes come along", () => {
  const stored = { state: "done", at: "", model: "m", runId: "r1", sheetsAt: "2026-11-17T01:00:00.000Z", note: "전 검사",
    scenes: [{ scene: 4, kind: "넘침", issue: "a", fix: "b" }, { scene: 13, kind: "겹침", issue: "c", fix: "d" }] };
  const cells = Array.from({ length: 24 }, (_, i) => i + 1);
  const kept = cells.filter((n) => n !== 14).map((n) => [n, n <= 13 ? n : n - 1]);
  const prepared = { kept, from: { runId: "r1", at: stored.sheetsAt }, cells };
  const part = carriedScreens(prepared, stored, ["s1", "s2"]);
  assert.deepEqual(part.fresh, [14]);
  assert.deepEqual(part.urls, ["s2"], "the sheet without a new cell is not sent");
  assert.deepEqual(part.carried.map((item) => item.scene), [4, 13]);
  assert.equal(carriedScreens(prepared, { ...stored, runId: "r2" }, ["s1", "s2"]), null, "another check: all of it again");
  const check = read("lib/server/myin-screen-check.ts");
  assert.match(check, /part && !part\.fresh\.length \? JSON\.stringify\(\{ scenes: \[\], note: "바뀐 장면이 없어요\." \}\)/, "nothing drawn again: no GPT call");
});

test("the sheets before travel with the run: a voice fix, the gate's round, the earlier run that lent its storyboard", () => {
  const run = read("lib/server/myin-run.ts");
  assert.match(run, /const before = prepRef\(record\.id, run\);\n\s*const next: MyinRun = \{ \.\.\.run, attempts: 0, \.\.\.\(before \? \{ lastPrep: before \} : \{\}\) \};/);
  assert.match(run, /const sheetsNow = prepRef\(record\.id, next\);\n\s*if \(sheetsNow\) back\.lastPrep = sheetsNow;/);
  assert.match(run, /sheets: prepRef\(found\.id, donor\)/);
  assert.match(run, /\.\.\.\(loan\.sheets \? \{ lastPrep: loan\.sheets \} : \{\}\)/);
  assert.match(run, /const prior = run\.lastPrep && run\.lastPrep\.engine === lease\.engine \? run\.lastPrep : undefined;/, "only sheets this engine drew, at ③ and ④");
  assert.match(run, /if \(!prepared\?\.cells \|\| !prepared\.sheets\.length \|\| !prepared\.engine \|\| prepared\.storyboardPath \|\| !run\.storyboard\) return undefined;/);
  assert.match(run, /delete next\.lease; delete next\.lastError; delete next\.lastPrep;/);
  assert.match(run, /next\.prepared!\.from = \{ runId: run\.lastPrep\.runId, at: run\.lastPrep\.at \}/);
  const worker = read("tools/youtube-media-worker.mjs");
  assert.match(worker, /\.catch\(\(\) => drawSheets\(myinDir, videoDir, previewEnv, job\.sheetUploadUrls\.length\)\)/, "trouble with the sheets before: all drawn");
  assert.match(worker, /\.\.\.\(kept\?\.length \? \{ kept \} : \{\}\)/);
});

test("④ starts from ③'s sheets; a photo uploaded since, or a 「사진 자리」 then, has its scenes drawn again", () => {
  const run = read("lib/server/myin-run.ts");
  const prep = run.slice(run.indexOf("async function beginPrep"), run.indexOf("/** [자료 준비 다시 하기]"));
  assert.match(prep, /const before = prepRef\(record\.id, run\);/, "stashed before the preparation is cleared");
  assert.match(run, /photos: photoKeys\(run\), missing: \(prepared\.photosMissing \?\? \[\]\)\.slice\(0, 200\)/);
  assert.match(run, /\.\.\.Object\.entries\(run\.ours \?\? \{\}\)\.map\(\(\[file, image\]\) => \[file, image\.path\] as const\)/, "our upload wins over the listed photo");
  assert.match(run, /filter\(\(file\) => now\[file\] !== then\[file\]\) : Object\.keys\(now\)/, "sheets from before this change redraw every photo scene");
  assert.match(run, /if \(bundle\.missingPhotos\?\.length\) next\.prepared!\.photosMissing = bundle\.missingPhotos;/);
  const worker = read("tools/youtube-media-worker.mjs");
  assert.match(worker, /return \[\.\.\.new Set\(\(job\.placeholders \?\? \[\]\)\.filter\(\(spot\) => !fetched\[`\$\{spot\.kind\}\/\$\{spot\.file\}`\]\)/);
  assert.match(worker, /if \(old && job\.previous\.redraw\?\.length\) \{/);
  assert.match(worker, /\[redrawScript, "os_myin", oldStory, oldDir, out, \.\.\.\(redrawFiles \? \[redrawFiles\] : \[\]\)\]/);
  assert.match(read("tools/myin_redraw.py"), /if forced: keep = \{i: k for i, k in keep\.items\(\) if not any\(f in keys\[i\] for f in forced\)\}/);
});
