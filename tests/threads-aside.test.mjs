import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as posts from "../lib/threads-posts.ts";

const source = await readFile(new URL("../lib/threads-aside.ts", import.meta.url), "utf8");
const compiled = { exports: {} };
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module: compiled, exports: compiled.exports, require: name => { assert.equal(name, "./threads-posts"); return posts; } });
const { parseThreadsAsideResult, threadsAsideRequest } = compiled.exports;

test("Aside result preserves paragraphs and accepts one whole fenced result, not surrounding commentary", () => {
  const result = { posts: ["본문\n\n실제 장면", "관점\n근거", "적용"] };
  for (const input of [JSON.stringify(result), "```json\n" + JSON.stringify(result) + "\n```", "```\n" + JSON.stringify(result) + "\n```"])
    assert.equal(JSON.stringify(parseThreadsAsideResult(input)), JSON.stringify(result));
  assert.throws(() => parseThreadsAsideResult("설명\n" + JSON.stringify(result)), /결과 블록/);
});

test("intake refuses malformed, empty and oversized posts without truncating meaning", () => {
  for (const input of ["{}", "[]", "null", '{"posts":[1]}', '{"posts":[]}', '{"posts":[" "]}', JSON.stringify({ posts: ["글".repeat(501)] })])
    assert.throws(() => parseThreadsAsideResult(input));
  assert.equal(parseThreadsAsideResult(JSON.stringify({ posts: ["😀".repeat(500)] })).posts[0].length, 1000);
});

test("handoff ties writing and unapproved save to one item and its frozen instructions", () => {
  const instructions = { canonical: { version: 21, text: "읽을 기준" }, brief: { question: "이번 질문" } };
  const request = threadsAsideRequest(instructions, "https://example.test/automation/threads?sel=item", "job");
  assert.ok(request.includes(JSON.stringify(instructions, null, 2)));
  assert.match(request, /대상 작업 ID: job/);
  assert.match(request, /‘집필 요청 확인’을 펼쳐 현재 작업 ID/);
  assert.match(request, /다르면 저장하지 말고/);
  assert.match(request, /미승인 초안 저장/);
  assert.match(request, /OS를 조작할 수 없으면/);
  assert.match(request, /결과 채택·팀 공유·최종 확인·승인·예약·발행은 하지/);
});
