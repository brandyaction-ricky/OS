import assert from "node:assert/strict";
import test from "node:test";
import { developmentCommentCreateSchema, developmentCommentMetadata, isDevelopmentComment } from "../lib/development-comments.ts";

const requestId = "80950395-23b2-4b5a-bd0f-c3d8b8b78d92";
const replyTo = "28e1749d-92b9-476b-a17c-eb5be59d2822";

test("development comment input trims content and validates request relationships", () => {
  const parsed = developmentCommentCreateSchema.parse({ requestId, body: "  확인했습니다.  ", replyTo });
  assert.equal(parsed.body, "확인했습니다.");
  assert.equal(parsed.replyTo, replyTo);
  assert.equal(developmentCommentCreateSchema.safeParse({ requestId, body: "   " }).success, false);
  assert.equal(developmentCommentCreateSchema.safeParse({ requestId: "invalid", body: "내용" }).success, false);
  assert.equal(developmentCommentCreateSchema.safeParse({ requestId, body: "x".repeat(5_001) }).success, false);
});

test("development comment metadata keeps an immutable request and reply link", () => {
  assert.deepEqual(developmentCommentMetadata({ requestId, replyTo, authorName: "브랜디", authorType: "member" }), {
    kind: "development_comment", requestId, replyTo, authorName: "브랜디", authorType: "member",
  });
  assert.equal(isDevelopmentComment({ record_type: "development_comment", metadata: { kind: "development_comment" } }), true);
  assert.equal(isDevelopmentComment({ record_type: "ai_job", metadata: { kind: "development_comment" } }), false);
});
