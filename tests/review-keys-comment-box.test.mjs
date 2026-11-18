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

// 최종 검토 전체화면 (직원 요청 2026-11-18): one button at the right end of the play bar fills the screen with the picture and its controls.
test("최종 검토 has a fullscreen button that fills the screen with the player, and an iPhone falls back to the video's own player", () => {
  const final = read("components/youtube-process-final.tsx");
  assert.match(final, /<div className="yp-player" ref=\{playerBox\}>/);
  assert.match(final, /if \(document\.fullscreenElement\) \{ void document\.exitFullscreen\(\); return; \}/);
  assert.match(final, /if \(box\?\.requestFullscreen\) void box\.requestFullscreen\(\)\.catch\(\(\) => undefined\);/);
  assert.match(final, /\?\.webkitEnterFullscreen\?\.\(\);/);
  assert.match(final, /className="yp-cb yp-fs" aria-label=\{full \? "전체화면 나가기" : "전체화면"\}/);
  const css = read("components/youtube-process.css");
  assert.match(css, /\.yp-ctrl \.yp-fs\{margin-left:auto\}/, "right end even when the controls wrap on a phone");
  assert.match(css, /\.yp-player:fullscreen \.yp-stage:not\(\.yp-compare\) \.yp-frame\{width:min\(100cqw,calc\(100cqh \* 16 \/ 9\)\);max-height:none\}/, "the picture keeps 16:9 so drawn marks stay on it");
  assert.match(css, /\.yp-player:fullscreen \.yp-ctrl2/);
});
