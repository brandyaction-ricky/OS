import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { appendOnly, applyFeedback, FeedbackRuleError, feedbackClosed, normalizeReplies } from "../lib/youtube-process/feedback.ts";

const author = { id: "u-author", name: "안저", admin: false };
const editor = { id: "u-editor", name: "로건", admin: false };
const base = { text: "이 부분 자막을 한 줄로", whoId: "u-author", status: "open", declinedWhy: "", fixedIn: null, replies: [] };
const now = "2026-10-29T08:00:00.000Z";
const fails = (fn, code) => assert.throws(fn, error => error instanceof FeedbackRuleError && error.code === code);

test("R03: the editor's ✓ 반영 and the requester's 확인 are kept apart; reopening clears both", () => {
  const done = applyFeedback(base, editor, { action: "resolve" }, now, 3, "video");
  assert.deepEqual([done.status, done.doneBy, done.fixedIn, done.confirmedBy], ["done", "로건", 3, undefined]);
  fails(() => applyFeedback(done, editor, { action: "confirm" }, now, 3, "video"), "CONFIRM_FORBIDDEN");
  fails(() => applyFeedback(base, author, { action: "confirm" }, now, 3, "video"), "NOT_DONE");
  const confirmed = applyFeedback(done, author, { action: "confirm" }, now, 3, "video");
  assert.equal(confirmed.confirmedBy, "안저");
  assert.equal(applyFeedback(done, { ...editor, admin: true }, { action: "confirm" }, now, 3, "video").confirmedBy, "로건", "an admin may confirm for the team");
  const reopened = applyFeedback(confirmed, editor, { action: "reopen" }, now, 3, "video");
  assert.deepEqual([reopened.status, reopened.doneBy, reopened.confirmedBy, reopened.fixedIn], ["open", undefined, undefined, null]);
  assert.equal(applyFeedback(confirmed, editor, { action: "resolve" }, now, 4, "video").confirmedBy, undefined, "a new ✓ needs a new confirmation");
  assert.equal(applyFeedback(base, editor, { action: "resolve" }, now, 4, "A").fixedIn, null, "thumbnails have no video version");
});

test("R02/R04: replies continue after resolve, each with an id and an owner; only the owner edits or deletes", () => {
  const done = applyFeedback(base, editor, { action: "resolve" }, now, 2, "video");
  const replied = applyFeedback(done, author, { action: "reply", text: "  확인했어요, 한 가지만 더  " }, now, 2, "video");
  const reply = replied.replies[0];
  assert.deepEqual([reply.by, reply.byId, reply.text, typeof reply.id], ["안저", "u-author", "확인했어요, 한 가지만 더", "string"]);
  assert.equal(replied.status, "done", "a reply does not reopen the item");
  fails(() => applyFeedback(replied, author, { action: "reply", text: "   " }, now, 2, "video"), "REPLY_REQUIRED");
  fails(() => applyFeedback(replied, editor, { action: "reply_edit", replyId: reply.id, text: "남의 답글" }, now, 2, "video"), "REPLY_FORBIDDEN");
  const edited = applyFeedback(replied, author, { action: "reply_edit", replyId: reply.id, text: "고친 답글" }, now, 2, "video");
  assert.deepEqual([edited.replies[0].text, edited.replies[0].editedAt], ["고친 답글", now]);
  const deleted = applyFeedback(edited, author, { action: "reply_delete", replyId: reply.id }, now, 2, "video");
  assert.deepEqual([deleted.replies.length, deleted.replies[0].deleted, deleted.replies[0].text], [1, true, ""]);
  fails(() => applyFeedback(deleted, author, { action: "reply_edit", replyId: reply.id, text: "x" }, now, 2, "video"), "REPLY_DELETED");
  fails(() => applyFeedback(deleted, author, { action: "reply_delete", replyId: "nope" }, now, 2, "video"), "REPLY_NOT_FOUND");
});

test("R04: only the author edits or deletes the item; a deleted item keeps its thread and no longer waits", () => {
  fails(() => applyFeedback(base, editor, { action: "edit", text: "남의 글" }, now, 1, "video"), "EDIT_FORBIDDEN");
  fails(() => applyFeedback(base, editor, { action: "delete" }, now, 1, "video"), "DELETE_FORBIDDEN");
  const edited = applyFeedback(base, author, { action: "edit", text: "자막을 두 줄 이하로" }, now, 1, "video");
  assert.deepEqual([edited.text, edited.editedAt], ["자막을 두 줄 이하로", now]);
  const threaded = applyFeedback(edited, editor, { action: "reply", text: "네" }, now, 1, "video");
  const deleted = applyFeedback(threaded, author, { action: "delete" }, now, 1, "video");
  assert.deepEqual([deleted.deleted, deleted.text, deleted.replies.length], [true, "", 1]);
  assert.equal(feedbackClosed(deleted), true);
  assert.equal(feedbackClosed(base), false);
  fails(() => applyFeedback(deleted, author, { action: "edit", text: "되살리기" }, now, 1, "video"), "FEEDBACK_DELETED");
  fails(() => applyFeedback(base, editor, { action: "decline", text: " " }, now, 1, "video"), "REASON_REQUIRED");
});

test("old replies without ids stay readable; replies, confirmations and own edits use the latest row, status flips keep the version check", () => {
  assert.deepEqual(normalizeReplies([{ by: "로건", text: "옛 답글", at: "2026-10-01T00:00:00Z" }]), [{ id: "legacy-2026-10-01T00:00:00Z", by: "로건", byId: "", text: "옛 답글", at: "2026-10-01T00:00:00Z" }]);
  assert.deepEqual(normalizeReplies(null), []);
  for (const action of ["reply", "reply_edit", "reply_delete", "confirm", "unconfirm", "edit", "delete"]) assert.equal(appendOnly(action), true, action);
  for (const action of ["resolve", "reopen", "decline"]) assert.equal(appendOnly(action), false, action);
  const server = readFileSync("lib/server/youtube-process-feedback.ts", "utf8");
  assert.match(server, /if \(!appendOnly\(input\.action\) && row\.version !== input\.expectedVersion\) throw conflict\(\);/);
  assert.match(server, /if \(!saved\) \{ if \(appendOnly\(input\.action\)\) continue; throw conflict\(\); \}/);
  const screen = readFileSync("components/youtube-process-final.tsx", "utf8");
  assert.match(screen, /if \(await run\(mode\.kind, draft\.trim\(\), mode\.replyId\)\) \{ setMode\(null\); setDraft\(""\); \}/, "the reply box closes only after a successful save");
  assert.match(screen, /window\.setInterval\(refresh, 30_000\)/);
});

test("N01·N02: search covers text, replies and who; filters by status; a deleted item shows only under 전체", async () => {
  const { feedbackMatches } = await import("../lib/youtube-process/feedback.ts");
  const item = { text: "자막을 한 줄로", who: "안저", status: "open", replies: [{ text: "장면 전환 늦춰요", by: "로건" }] };
  assert.ok(feedbackMatches(item, "", "all"));
  assert.ok(feedbackMatches(item, "장면 로건", "open"), "every word must match somewhere in the thread");
  assert.ok(!feedbackMatches(item, "썸네일", "all"));
  assert.ok(!feedbackMatches(item, "", "done"));
  assert.ok(feedbackMatches({ ...item, status: "declined" }, "", "declined"));
  assert.ok(!feedbackMatches({ ...item, deleted: true }, "", "open"));
  assert.ok(feedbackMatches({ ...item, deleted: true }, "", "all"));
});

test("N03: @mentions and reply recipients — author, earlier repliers and mentioned people, never the writer", async () => {
  const { mentionedIds, replyRecipients } = await import("../lib/youtube-process/feedback.ts");
  const members = [{ id: "a", name: "안저" }, { id: "l", name: "로건" }, { id: "p", name: "예시 PD" }];
  assert.deepEqual(mentionedIds("@로건 확인해 주세요, @예시PD도요", members).sort(), ["l", "p"]);
  assert.deepEqual(mentionedIds("메일 a@b.c 은 사람이 아니에요", members), []);
  assert.deepEqual(replyRecipients({ whoId: "a", replies: [{ byId: "l" }, { byId: "a" }] }, "@예시PD 봐 주세요", members, "l").sort(), ["a", "p"]);
  const notice = readFileSync("lib/personal-work.ts", "utf8");
  assert.match(notice, /return `\$\{stepHref\(4, record\.metadata\.projectId\)\}&feedback=\$\{id\}`;/, "a notice opens that feedback");
});

test("N04·N05: marks stay inside the frame, small and well formed", async () => {
  const { cleanMarks } = await import("../lib/youtube-process/feedback.ts");
  assert.deepEqual(cleanMarks([{ type: "pin", points: [[1.4, -0.2], [0.5, 0.5]] }]), [{ type: "pin", points: [[1, 0]] }]);
  assert.deepEqual(cleanMarks([{ type: "rect", points: [[0.1, 0.2]] }, { type: "circle", points: [[0, 0], [1, 1]] }, "x"]), []);
  assert.deepEqual(cleanMarks([{ type: "arrow", points: [[0.12345, 0.5], [0.9, 0.9], [0.1, 0.1]] }])[0].points, [[0.123, 0.5], [0.9, 0.9]]);
  assert.equal(cleanMarks(Array.from({ length: 30 }, () => ({ type: "pin", points: [[0.5, 0.5]] }))).length, 20);
  assert.equal(cleanMarks([{ type: "free", points: Array.from({ length: 500 }, (_, i) => [i / 500, 0.5]) }])[0].points.length, 200);
});

test("N06·N07: attachments stay under the project as images or PDFs; any existing version takes feedback; B follows A with an offset", async () => {
  const { compareTime, feedbackFilePath, FEEDBACK_FILE_TYPES } = await import("../lib/youtube-process/feedback.ts");
  const project = "11111111-2222-3333-4444-555555555555";
  assert.ok(feedbackFilePath(project).test(`feedback/${project}/1793260000000-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png`));
  assert.ok(!feedbackFilePath(project).test(`feedback/99999999-2222-3333-4444-555555555555/1793260000000-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png`), "another project's file is refused");
  assert.ok(!feedbackFilePath(project).test(`feedback/${project}/1793260000000-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.exe`));
  assert.deepEqual(Object.keys(FEEDBACK_FILE_TYPES).sort(), ["application/pdf", "image/gif", "image/jpeg", "image/png", "image/webp"]);
  assert.equal(compareTime(10, 2.5, 60), 12.5);
  assert.equal(compareTime(1, -3, 60), 0);
  assert.equal(compareTime(59, 5, 60), 60);
  const server = readFileSync("lib/server/youtube-process-feedback.ts", "utf8");
  assert.match(server, /if \(input\.ver < 1 \|\| input\.ver > latest\) throw new ApiError\(409, "NO_SUCH_VERSION"/);
  assert.match(server, /files\.length !== input\.files\.length\) throw new ApiError\(400, "FEEDBACK_FILE_INVALID"/);
  assert.match(server, /if \(!feedbackFilePath\(project\.id\)\.test\(path\)\) throw new ApiError\(400, "FEEDBACK_FILE_INVALID"/);
});
