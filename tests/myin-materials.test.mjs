import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { changedMaterials } from "../lib/myin-materials.ts";

// 유쓰 요청 3/8 보완 (2026-11-03): 재료 고정 — each result keeps the versions it was made from; a late result from other materials is not taken.
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const base = { voice: "v1", storyboard: "s1", sound: "", subtitles: "", ours: "o1", style: "" };

test("the record names the materials that changed since a result was made", () => {
  assert.deepEqual(changedMaterials(base, base), [], "same materials: 지금 재료와 같아요");
  assert.deepEqual(changedMaterials(base, { ...base, ours: "o2", subtitles: "t1" }), ["자막", "사진"]);
  assert.deepEqual(changedMaterials(base, { ...base, sound: "e1" }), [], "a sound edit does not make the sheets or previews stale");
  assert.deepEqual(changedMaterials(base, { ...base, sound: "e1" }, true), ["사운드"], "it does make the full video stale");
  assert.equal(changedMaterials(undefined, base), null, "a result made before materials were kept says nothing");
});

test("a job's result is taken only at the stage it was claimed at and from the materials the run still has", async () => {
  const run = await read("lib/server/myin-run.ts");
  const section = (from, to) => run.slice(run.indexOf(from), run.indexOf(to));
  assert.match(section("async function leased", "const bundleSchema"), /run\.lease\.stage && run\.lease\.stage !== data\.stage/, "a run that moved on (수정 요청) takes no late result");
  assert.match(section("async function claim(", "async function failed"), /startedAt: new Date\(\)\.toISOString\(\), stage,/);
  for (const [claim, end] of [["export async function claimMyinPrep", "/** Render PC: the preview ran."], ["export async function claimMyinClips", "export async function completeMyinClips"],
    ["export async function claimMyinFinal", "export async function completeMyinFinal"]])
    assert.match(section(claim, end), /, materialsKey, drawnWith\)/, `${claim} hands out its materials key`);
  assert.match(section("export async function completeMyinPrep", "export async function failMyinPrep"), /if \(staleResult\(run\)\)/);
  const clips = section("export async function completeMyinClips", "/** Logan's OK on the clips");
  assert.match(clips, /if \(staleResult\(run\)\)[\s\S]*prepAgain \? "prep_pending" : "clips_pending"/, "an image changed while cutting: prepare again, then cut");
  assert.match(clips, /used: materials\(run\)/);
  assert.match(section("export async function completeMyinFinal", "export async function failMyinStage"), /if \(staleResult\(run\)\)[\s\S]*used: materials\(run\)/);
  // A run that starts over drops the old job's lease, so its late result cannot land on the new start.
  assert.match(section("export async function reviewMyinStoryboard", "/** ③ drafts go to"), /decision === "revise"\) \{[^}]*delete next\.lease/);
  assert.match(section("async function beginDraft", "/** ④ 자료 준비, after"), /delete next\.lease/);
  assert.match(section("async function beginPrep", "/** [자료 준비 다시 하기]"), /delete next\.lease/);
});

test("the 제작 기록 shows whether each result still matches the materials", async () => {
  const record = (await read("lib/server/myin-run.ts")).split("export async function myinRecord")[1];
  assert.match(record, /changed: changedSince\(run\.prepared\.used, run\)/);
  assert.match(record, /changed: changedSince\(run\.final\.used, run, true\)/);
  assert.match(await read("components/myin-run-record.tsx"), /바뀐 재료: /);
});
