import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { lengthEstimate, paragraphTimes } from "../lib/youtube-process/stages.ts";
import { checkScriptBody, PULLING_CHARS_PER_MINUTE } from "../lib/youtube-script-check.ts";

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

test("풀링형 예상 길이 = 공백 뺀 글자 × 0.165초(실측: 원리 1편 3,254자 538초); 키풀링형 stays 350자/분", () => {
  assert.equal(lengthEstimate("가".repeat(3254), null, null, true).label, "약 8분 30초");   // 537초(화면은 30초 단위로 내림) — 실제 538초
  assert.equal(lengthEstimate("가".repeat(3696), null, null).label, "약 10분 30초");   // 3696 / 350 = 10.56분
  assert.equal(Math.round(paragraphTimes(["가".repeat(80), "나".repeat(80)], null, true)[1].at * 10) / 10, 13.2);
  assert.equal(PULLING_CHARS_PER_MINUTE, 364);   // 9분 → 3,276자 (공백 제외)
});

test("풀링형 목표 글자 수 · 길이 메모는 공백 제외 364자/분; 원고형은 공백 포함 490자/분 그대로", () => {
  const para = "가 나 ".repeat(40);   // 160자, 공백 제외 80자
  const paragraphs = Array.from({ length: 37 }, () => para);   // 공백 제외 2,960자 = 9분 3,276자의 -9.6%
  assert.deepEqual(checkScriptBody(paragraphs, 9, null, "", true).notes.filter(n => n.includes("목표")), []);
  assert.match(checkScriptBody(paragraphs, 9).notes.join(" "), /목표 9분\(4410자\)/);   // 같은 원고를 원고형으로 세면 공백 포함 5,920자 — 4,410자와 15% 넘게 차이
  assert.match(checkScriptBody(paragraphs.slice(0, 20), 9, null, "", true).notes.join(" "), /공백 제외 1600자.*공백 제외 3276자/);
  assert.match(read("lib/server/youtube-process-ai.ts"), /targetChars: card\.targetMinutes \* \(pulling \? PULLING_CHARS_PER_MINUTE : CHARS_PER_MINUTE\)/);
});
