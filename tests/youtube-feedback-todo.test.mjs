import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { feedbackKind } from "../lib/youtube-process/feedback.ts";

// 유쓰 요청 7/8 (2026-11-02): 최종 검토 notes grouped as 소리 · 자막 · 화면 · 기타 to read by; the notes themselves stay as they are.
test("notes fall into the fix they ask for", () => {
  const cases = { "음악 줄여요": "sound", "BGM 볼륨 낮춰 주세요": "sound", "목소리가 어색해요": "sound", "띄어 읽어요": "sound",
    "자막 오타 마이안 → 마이인": "subtitle", "자막 띄어쓰기": "subtitle", "글자가 너무 작아요": "subtitle",
    "그림 바꿔요": "screen", "배경 사진이 흐려요": "screen", "도식이 너무 빨리 넘어가요": "screen", "여기 너무 길어요": "other" };
  for (const [text, kind] of Object.entries(cases)) assert.equal(feedbackKind(text), kind, text);
});

test("the grouped view only reads: no new note, no status change, no voice fix from it", async () => {
  const todo = await readFile(new URL("../components/youtube-process-feedback-todo.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(todo, /client\.|addFeedback|actFeedback|apiRequest|voice_fix|"resolve"/);
  const final = await readFile(new URL("../components/youtube-process-final.tsx", import.meta.url), "utf8");
  assert.match(final, /<FeedbackTodo items=\{openItems\}/, "it groups exactly the open notes the list shows (deleted ones are not there)");
  assert.match(final, /"시간,종류,내용,누가,상태"/, "the 편집용 목록 carries the kind too");
});
