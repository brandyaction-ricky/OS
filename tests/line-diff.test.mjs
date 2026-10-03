import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { diffMarkdownLines } from "../lib/line-diff.ts";

test("line diff keeps additions, removals, moved lines and empty lines", () => {
  const changes = diffMarkdownLines("첫 줄\n\n이동\n끝", "첫 줄\n이동\n\n새 줄\n끝");
  assert.deepEqual(changes.filter(item => item.kind === "removed").map(item => item.text), [""]);
  assert.deepEqual(changes.filter(item => item.kind === "added").map(item => item.text), ["", "새 줄"]);
  assert.equal(changes.at(-1).text, "끝");
  assert.equal(changes.at(-1).oldLine, 4);
  assert.equal(changes.at(-1).newLine, 5);
});

test("2,000-line documents compare within the review budget", () => {
  const before = Array.from({ length: 2000 }, (_, index) => `원고 ${index}`).join("\n");
  const after = before.replace("원고 1234", "원고 수정 1234");
  const start = performance.now();
  const changes = diffMarkdownLines(before, after);
  assert.ok(performance.now() - start < 1000);
  assert.equal(changes.filter(item => item.kind === "added").length, 1);
  assert.equal(changes.filter(item => item.kind === "removed").length, 1);
});
