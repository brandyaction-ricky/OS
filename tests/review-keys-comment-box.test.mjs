import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

// 최종 검토 (유쓰 요청 2026-11-10): ← → move 1 s to find the spot to comment on, Shift 5 s; the −5 / +5 buttons stay 5 s.
test("최종 검토 arrows move 1 s and Shift+arrows 5 s, never while typing, inside the video", () => {
  const final = read("components/youtube-process-final.tsx");
  assert.match(final, /nudgeRef\.current\(\(event\.key === "ArrowLeft" \? -1 : 1\) \* \(event\.shiftKey \? 5 : 1\)\)/);
  assert.match(final, /el\?\.closest\("input, textarea, select, \[contenteditable='true'\]"\)\) return;/);
  assert.match(final, /seek\(Math\.max\(0, Math\.min\(el\.duration \|\| Infinity, el\.currentTime \+ step\)\)\)/);
  assert.match(final, /onClick=\{\(\) => nudge\(-5\)\}>−5/);
  assert.match(final, /onClick=\{\(\) => nudge\(5\)\}>\+5/);
  assert.match(final, /← →로 1초씩, Shift를 누르고 5초씩 옮기고/);
  assert.doesNotMatch(final, /← →로 5초씩/);
});

// 수정 요청 댓글 (로건 요청 2026-11-09): a taller box that grows with the text.
test("the request comment box starts taller and grows with what is written", () => {
  const css = read("components/development-workspace.css");
  assert.match(css, /\.dev-comment-form textarea, \.dev-comment-edit textarea \{ min-height: 120px; max-height: 50vh; field-sizing: content; \}/);
  assert.equal((read("components/project-hub-workspace.tsx").match(/rows=\{5\} maxLength=\{5000\}/g) ?? []).length, 2);
});
