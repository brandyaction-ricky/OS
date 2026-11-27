import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// 직원 요청 11-19: the upload sends YouTube's AI label the person chose; not chosen stops the upload instead of meaning 아니요.
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("예 / 아니요 go up as status.containsSyntheticMedia true / false, for the video and its Shorts", () => {
  const upload = read("lib/server/youtube-process-upload.ts");
  assert.match(upload, /const aiLabel = \(ai: YpUpload\["ai"\]\) => ai \? \{ containsSyntheticMedia: ai === "yes" \} : \{\}/);
  assert.match(upload, /if \(!upload\.ai\) throw new ApiError\(409, "AI_DISCLOSURE_REQUIRED"/);
  assert.equal(upload.match(/\.\.\.aiLabel\(/g)?.length, 3, "longform (now · scheduled) and the clip Short");
  assert.match(upload, /ai: video\.status\.containsSyntheticMedia/, "what YouTube reports is kept on the run");
});

test("the upload screen asks for it next to 공개 범위 and the patch keeps 미선택 apart from 아니요", () => {
  const screen = read("components/youtube-process-upload.tsx");
  assert.match(screen, /name="yp-ai"/);
  assert.match(screen, /!form\.ai \? "AI 사용 공개를 골라 주세요"/);
  assert.match(read("lib/server/youtube-process-stages.ts"), /ai: z\.enum\(\["yes", "no"\]\)\.nullable\(\)/);
});
