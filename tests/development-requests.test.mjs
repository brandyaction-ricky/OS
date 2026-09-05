import assert from "node:assert/strict";
import test from "node:test";
import { developmentRequestCreateSchema, developmentRequestUpdateSchema, developmentRequestUpdateFields, isSafeDevelopmentLink, validateDevelopmentRequestUpdate } from "../lib/development-requests.ts";

const reporter = { id: "reporter", role: "member" };
const admin = { id: "admin", role: "admin" };
const current = { id: "a5e3150a-a8e5-48e5-84ce-d2c5e2041132", created_by: "reporter", status: "backlog", metadata: { kind: "development_request", category: "bug", pageUrl: "/home", resolution: "기존 처리 기록" } };
const patch = (fields) => developmentRequestUpdateSchema.parse({ id: current.id, expectedVersion: 2, ...fields });

test("report creation accepts real context but rejects forged status, ownership and result fields", () => {
  const valid = developmentRequestCreateSchema.parse({ title: "저장 버튼 오류", steps: "저장을 눌렀습니다.", pageUrl: "/knowledge", expectedResult: "입력한 문서 저장" });
  assert.equal(valid.priority, "normal");
  assert.equal(valid.parentId, null);
  for (const field of ["status", "ownerId", "created_by", "resolution", "metadata"]) {
    assert.equal(developmentRequestCreateSchema.safeParse({ title: "요청", [field]: "done" }).success, false);
  }
});

test("reporter may edit own backlog and reopen own review/done, but cannot manage results or other requests", () => {
  assert.doesNotThrow(() => validateDevelopmentRequestUpdate(current, patch({ title: "설명 보완" }), reporter));
  for (const status of ["review", "done"]) assert.doesNotThrow(() => validateDevelopmentRequestUpdate({ ...current, status }, patch({ status: "backlog" }), reporter));
  for (const status of ["active", "blocked", "review", "done"]) assert.throws(() => validateDevelopmentRequestUpdate({ ...current, status }, patch({ title: "수정" }), reporter));
  assert.throws(() => validateDevelopmentRequestUpdate(current, patch({ status: "done", resolution: "완료" }), reporter), { code: "REQUEST_ADMIN_REQUIRED" });
  assert.throws(() => validateDevelopmentRequestUpdate(current, patch({ status: "active" }), reporter), { code: "REQUEST_STATUS_FORBIDDEN" });
  assert.throws(() => validateDevelopmentRequestUpdate({ ...current, created_by: "other" }, patch({ title: "수정" }), reporter), { code: "REQUEST_OWNER_REQUIRED" });
  assert.throws(() => validateDevelopmentRequestUpdate({ ...current, status: "done" }, patch({ status: "backlog", description: "동시 수정" }), reporter));
});

test("completion requires a resolution but does not fabricate a deployment requirement", () => {
  assert.throws(() => validateDevelopmentRequestUpdate({ ...current, metadata: {} }, patch({ status: "done" }), admin), { code: "REQUEST_RESOLUTION_REQUIRED" });
  assert.doesNotThrow(() => validateDevelopmentRequestUpdate(current, patch({ status: "done", resolution: "사용 방법 안내로 해결" }), admin));
  assert.throws(() => validateDevelopmentRequestUpdate({ ...current, status: "done" }, patch({ resolution: "" }), admin));
});

test("request links reject executable schemes, credentials and protocol-relative paths", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,test", "https://user:pass@example.com", "//example.com", "/\\example.com"]) {
    assert.equal(isSafeDevelopmentLink(value, true), false, value);
    assert.equal(developmentRequestCreateSchema.safeParse({ title: "요청", attachmentUrl: value }).success, false);
  }
  assert.equal(isSafeDevelopmentLink("/knowledge/development?request=123", true), true);
  assert.equal(isSafeDevelopmentLink("https://github.com/brandyaction-ricky/OS/pull/23"), true);
  assert.equal(developmentRequestUpdateSchema.safeParse({ id: current.id, expectedVersion: 2, commitSha: "not-a-commit" }).success, false);
});

test("edits preserve existing request context and resolution without accepting arbitrary metadata", () => {
  const result = developmentRequestUpdateFields(current, patch({ title: "변경", steps: "재현 절차 보완" }));
  assert.equal(result.metadata.pageUrl, "/home");
  assert.equal(result.metadata.resolution, "기존 처리 기록");
  assert.equal(result.metadata.kind, "development_request");
  assert.equal(result.metadata.steps, "재현 절차 보완");
  assert.equal(result.title, "변경");
  assert.equal(developmentRequestUpdateSchema.safeParse({ id: current.id, expectedVersion: 2, metadata: { kind: "task" } }).success, false);
  assert.equal(developmentRequestUpdateSchema.safeParse({ id: current.id, expectedVersion: 2 }).success, false);
});
