import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { lengthEstimate, paragraphTimes } from "../lib/youtube-process/stages.ts";

// 풀링형 3편 시험 제작 (대표 2026-11-24): 반영 409 · 오프닝 필수 · 예상 길이.
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("반영 compares the 수정안's base scene by value: jsonb gives its keys back in another order", () => {
  const src = read("lib/server/myin-scene-notes.ts");
  assert.match(src, /isDeepStrictEqual\(JSON\.parse\(JSON\.stringify\(story\.scenes\[n - 1\]\)\)/);
  assert.doesNotMatch(src, /JSON\.stringify\(story\.scenes\[n - 1\]\) !== JSON\.stringify\(proposal\.base\.scene\)/);
});

test("풀링형 (cta []) may start without an opening; 키풀링형 still needs one", () => {
  assert.match(read("lib/myin-storyboard.ts"), /types\[0\] !== "opening" && story\.cta\.length\) issues\.push/);
  assert.match(read("lib/server/myin-storyboard-job.ts"), /풀링형은 오프닝 없이 첫 대사부터/);
});

test("풀링형 예상 길이 = 공백 뺀 글자 × 0.125초; 키풀링형 stays 350자/분", () => {
  const md = "가".repeat(3696);
  assert.equal(lengthEstimate(md, null, null, true).label, "약 7분 30초");   // 462초 = 7.7분
  assert.equal(lengthEstimate(md, null, null).label, "약 10분 30초");       // 3696 / 350 = 10.56분
  assert.equal(paragraphTimes(["가".repeat(80), "나".repeat(80)], null, true)[1].at, 10);
});
