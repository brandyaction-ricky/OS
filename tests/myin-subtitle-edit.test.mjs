import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applySubtitleEdits, subtitleIssues, subtitleLines, subtitleTextProblem } from "../lib/myin-subtitles.ts";

// 유쓰 요청 1/8 (2026-11-02): typos fixed across the subtitles change only words; the video's subtitles and the SRT follow the same file.
const ASS = ["[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  "Dialogue: 0,0:00:00.00,0:00:01.16,Default,,0,0,0,,마이안을 소개해요,", "Dialogue: 0,0:00:01.16,0:00:03.44,Default,,0,0,0,,이건 고쳐서 없앨 게 아니에요",
  "Dialogue: 0,0:00:03.44,0:00:04.68,Default,,0,0,0,,마이안 강점"].join("\r\n");

test("lines keep their numbers and times; only the chosen words change", () => {
  const lines = subtitleLines(ASS);
  assert.deepEqual(lines.map(line => [line.i, line.start, line.end]), [[0, "0:00:00.00", "0:00:01.16"], [1, "0:00:01.16", "0:00:03.44"], [2, "0:00:03.44", "0:00:04.68"]]);
  assert.equal(lines[0].text, "마이안을 소개해요,", "commas inside the words stay words");
  const { ass, applied, conflicts } = applySubtitleEdits(ASS, [{ i: 2, from: "마이안 강점", to: "마이인 강점" }]);
  assert.equal(applied, 1); assert.deepEqual(conflicts, []);
  assert.deepEqual(subtitleLines(ass).map(line => line.text), ["마이안을 소개해요,", "이건 고쳐서 없앨 게 아니에요", "마이인 강점"], "line 0 was not picked, so it stays");
  assert.deepEqual(subtitleLines(ass).map(line => line.start), lines.map(line => line.start));
});

test("after a re-made voice, an edit whose line reads otherwise is 확인 필요, not forced in", () => {
  const remade = ASS.replace("마이안 강점", "마이안의 강점");
  const { applied, conflicts } = applySubtitleEdits(remade, [{ i: 2, from: "마이안 강점", to: "마이인 강점" }, { i: 9, from: "x", to: "y" }]);
  assert.equal(applied, 0); assert.deepEqual(conflicts.sort(), [2, 9]);
});

test("words only, and Logan's 자막 검수 lines by number", () => {
  assert.ok(subtitleTextProblem("{\\b1}굵게"));
  assert.ok(subtitleTextProblem("두 줄\n자막"));
  assert.ok(subtitleTextProblem("  "));
  assert.equal(subtitleTextProblem("마이인"), "");
  assert.deepEqual(subtitleIssues("- 규칙 검사: 2건\n\n  - 2: 짧은 꼬리 줄 '옮길 거예요'\n  - 217: 표시 0.78초 '아니죠'\n"), [{ i: 2, note: "짧은 꼬리 줄 '옮길 거예요'" }, { i: 217, note: "표시 0.78초 '아니죠'" }]);
});

test("the render PC writes the sent subtitles before it draws, and the OS sends them to every drawing step", async () => {
  const worker = await import(`../tools/youtube-media-worker.mjs?subs=${Date.now()}`);
  const dir = mkdtempSync(path.join(os.tmpdir(), "myin-subs-"));
  writeFileSync(path.join(dir, "subs_myin.ass"), "original");
  worker.writeSubtitles(dir, undefined);
  assert.equal(readFileSync(path.join(dir, "subs_myin.ass"), "utf8"), "original", "an OS without edits sends none");
  worker.writeSubtitles(dir, ASS);
  assert.equal(readFileSync(path.join(dir, "subs_myin.ass"), "utf8"), ASS);
  const source = await readFile(new URL("../tools/youtube-media-worker.mjs", import.meta.url), "utf8");
  assert.equal(source.match(/writeSubtitles\(videoDir, job\.subtitlesAss\)/g)?.length, 4, "prep, sheets drawn again, clips and the full video");
  const run = await readFile(new URL("../lib/server/myin-run.ts", import.meta.url), "utf8");
  assert.equal(run.match(/\.\.\.await subtitlesFor\(service, run\)/g)?.length, 6, "the three claims, the sheets drawn again, the scene pictures and the downloads");
  assert.match(run, /"final_pending"\]\.includes\(record\.stage/, "no edits while the full video is drawn");
});
