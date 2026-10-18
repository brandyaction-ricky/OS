import assert from "node:assert/strict";
import test from "node:test";
import { threadsPostLength,threadsPostRole,threadsPostsProblem } from "../lib/threads-posts.ts";

// AI intake (lib/content-automation-results.ts) and the save check call the same threadsPostsProblem.
// Shape of the R01/D01 results: four posts, each with paragraph breaks inside.
const four=["본문 첫 문단\n\n둘째 문단\n셋째 줄","관점 댓글\n\n근거 문단","적용 대댓글\n\n- 하나\n- 둘","https://example.com/source"];

test("a post with paragraph breaks stays one post in the shared rule",()=>{
  assert.equal(threadsPostsProblem(four),null);
  assert.equal(four.length,4);
});

test("the shared rule counts length the same way (emoji = 1)",()=>{
  const emoji="😀".repeat(500);
  assert.equal(threadsPostLength(emoji),500);
  assert.equal(threadsPostsProblem([emoji]),null);
  assert.match(threadsPostsProblem([emoji+"!"]),/500자/);
});

test("empty posts and malformed arrays are refused everywhere",()=>{
  assert.match(threadsPostsProblem(["글","  "]),/2번 글이 비어/);
  assert.match(threadsPostsProblem("글"),/형식/);
  assert.match(threadsPostsProblem([1]),/형식/);
  assert.match(threadsPostsProblem([],1),/첫 글/);
  assert.equal(threadsPostsProblem([]),null);
  assert.match(threadsPostsProblem(Array(31).fill("글")),/30개/);
});

test("roles follow the reply chain and a trailing bare link is the source link",()=>{
  assert.equal(threadsPostRole(four,0),"본문");
  assert.equal(threadsPostRole(four,1),"1번 글에 답글");
  assert.equal(threadsPostRole(four,3),"원문 링크 · 3번 글에 답글");
});
