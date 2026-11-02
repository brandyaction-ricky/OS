import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// 유쓰 요청 2/8 (2026-11-02): a problem scene's picture swapped — same length and voice — and the finished video kept as a version.
const run = await readFile(new URL("../lib/server/myin-run.ts", import.meta.url), "utf8");
const section = (from, to) => run.slice(run.indexOf(from), run.indexOf(to));

test("the photos are listed by the scenes that show them, and open after the finished video", () => {
  assert.match(section("function photoSources", "export async function myinPhotos"), /scenes\.flatMap\(\(scene, i\) => myinPhotoFolders\(scene\)\.has\(file\) \? \[i \+ 1\]/);
  assert.match(run, /open: record\.stage !== "final_pending"/, "closed only while the full video is drawn");
});

test("after the finished video, an image takes the run back to ④ and keeps that video", () => {
  const save = section("export async function saveMyinOurImage", "// ── Stage 4:");
  assert.match(save, /const back = record\.stage === "final_ready"/);
  assert.match(save, /back \? "prep_ready"/);
  assert.doesNotMatch(save, /delete next\.final|retireFinal/, "the finished video stays until a new one is made");
});

test("a preparation handed other images than the run has now is made again, not taken", () => {
  assert.match(section("export async function claimMyinPrep", "/** Render PC: the preview ran."), /oursKey\);/);
  const complete = section("export async function completeMyinPrep", "export async function failMyinPrep");
  assert.match(complete, /run\.lease\?\.input && run\.lease\.input !== oursKey\(run\)[\s\S]*"prep_pending"/);
});
