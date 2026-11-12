import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyScriptNote, noteSpot, notesOverlap, quoteFromSelection } from "../lib/youtube-process/stages.ts";

const md = "## 도입\n\n친구가 **진짜** 원하는 걸 물었어요.\n\n저는 답을 못 했어요. 그래서 적어 봤어요.\n\n저는 답을 못 했어요. 두 번째예요.";
const note = (over) => ({ id: "n1", text: "더 구체적으로", v: 3, by: "PD", at: "t", state: "open", ...over });

test("a drag across paragraphs and bold text maps to the exact markdown, taking whole mark pairs", () => {
  const found = quoteFromSelection(md, "진짜 원하는 걸 물었어요.저는 답을", "친구가 ");
  assert.equal(found.quote, "**진짜** 원하는 걸 물었어요.\n\n저는 답을");
  assert.equal(found.before, "## 도입\n\n친구가 ");
});

test("repeated words are told apart by the text before them, or refused", () => {
  const second = quoteFromSelection(md, "저는 답을 못 했어요.", "그래서 적어 봤어요.");
  assert.equal(noteSpot(md, second).at, md.lastIndexOf("저는 답을 못 했어요."));
  assert.match(quoteFromSelection(md, "저는 답을 못 했어요.", "엉뚱한 앞글").problem, /여러 번/);
  assert.match(quoteFromSelection(md, "원고에 없는 글", "").problem, /맞출 수 없어요/);
});

test("「반영」 replaces only the passage, keeps a version, and refuses when the passage moved or is ambiguous", () => {
  const spot = quoteFromSelection(md, "그래서 적어 봤어요.", "저는 답을 못 했어요. ");
  const proposal = { text: "그래서 종이에 한 줄씩 적어 봤어요.", why: "장면을 구체적으로", by: "AI", model: "m", at: "t", jobId: "j" };
  const outline = { spec: {}, script: md, versions: [], notes: [note({ ...spot, state: "proposed", proposal })] };
  const next = applyScriptNote(outline, "n1", "PD", "now");
  assert.equal(next.script, md.replace("그래서 적어 봤어요.", proposal.text));
  assert.equal(next.versions.at(-1).why, "ai");
  assert.equal(next.notes[0].state, "applied");
  assert.throws(() => applyScriptNote(next, "n1", "PD", "now"), /수정안이 온 의견만/);
  const moved = { ...outline, script: md.replace("그래서 적어 봤어요.", "다르게 고친 문장") };
  assert.throws(() => applyScriptNote(moved, "n1", "PD", "now"), /찾지 못했어요/);
  assert.throws(() => applyScriptNote({ ...outline, notes: [note({ ...spot, state: "open" })] }, "n1", "PD", "now"), /수정안이 온 의견만/);
});

test("overlapping passages are caught before they go to 내 AI together", () => {
  const a = note({ id: "a", ...quoteFromSelection(md, "원하는 걸 물었어요.", "친구가 진짜 ") });
  const b = note({ id: "b", ...quoteFromSelection(md, "물었어요.저는", "원하는 걸 ") });
  const c = note({ id: "c", ...quoteFromSelection(md, "두 번째예요.", "저는 답을 못 했어요. ") });
  assert.equal(notesOverlap(md, [a, b]), true);
  assert.equal(notesOverlap(md, [a, c]), false);
});

test("a 수정안 is saved beside its note and never written into the 원고; the screen sends the 원고 with every note change", () => {
  const save = readFileSync("lib/server/youtube-script-notes.ts", "utf8");
  const body = save.slice(save.indexOf("export async function saveScriptNotes"));
  assert.match(body, /\{ \.\.\.stages\.outline\.data, notes \}/);
  assert.doesNotMatch(body, /script:/);
  const screen = readFileSync("components/youtube-process-outline.tsx", "utf8");
  assert.match(screen, /save\(\{ spec: form\.spec, script: form\.script, \.\.\.patch \}, form\)/);
  // U is a letter while typing: inputs, textareas and the editor keep it.
  assert.match(screen, /closest\("input, textarea, select, \[contenteditable='true'\], \[contenteditable=''\]"\)/);
  assert.match(screen, /event\.isComposing \|\| event\.keyCode === 229/);
});
