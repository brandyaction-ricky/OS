import assert from "node:assert/strict";
import test from "node:test";
import { newProjectMeta } from "../lib/youtube-process/project.ts";
import { applyGateAction, confirmTab, dueReminders, editableFields, firstRemindAt, nextRemindAt, quietHours } from "../lib/youtube-process/confirm.ts";

const kst = (date, time) => new Date(`${date}T${time}:00+09:00`).toISOString();
const project = (id = "p1") => ({ id, yp: newProjectMeta({ type: "live", target: "타겟", note: "", refs: [] }, kst("2026-10-17", "09:00")).yp });
const act = (p, action, input = {}, gate = "topic") => ({ ...p, yp: applyGateAction(p, gate, action, { actor: "pd", now: kst("2026-10-17", "10:00"), ...input }) });

test("request → OK opens the 기획안 step; the round counts requests", () => {
  const waiting = act(project(), "request");
  assert.equal(waiting.yp.gates.topic.state, "wait");
  assert.equal(waiting.yp.gates.topic.round, 1);
  const ok = act(waiting, "ok", { actor: "ceo" });
  assert.equal(ok.yp.gates.topic.state, "ok");
  assert.equal(ok.yp.stage, "draft");
  assert.equal(ok.yp.gates.topic.decidedBy, "ceo");
});

test("수정 요청 needs ticked fields and a memo; the PD may then edit only those (수용 6)", () => {
  const waiting = act(project(), "request");
  assert.throws(() => act(waiting, "changes", { fields: [], memo: "x" }), /고칠 칸/);
  assert.throws(() => act(waiting, "changes", { fields: ["topic.title"], memo: " " }), /메모/);
  assert.throws(() => act(waiting, "changes", { fields: ["nope"], memo: "x" }), /고칠 칸/);
  const changes = act(waiting, "changes", { actor: "ceo", fields: ["topic.title", "topic.target"], memo: "타겟을 좁혀 주세요" });
  assert.deepEqual(editableFields(changes, "topic"), ["topic.title", "topic.target"]);
  assert.deepEqual(editableFields(waiting, "topic"), []);
  assert.equal(editableFields(project(), "topic"), "all");
});

test("re-requesting without editing anything after 수정 요청 needs a one-line reason (수용 6)", () => {
  const changes = act(act(project(), "request"), "changes", { actor: "ceo", fields: ["topic.title"], memo: "제목", now: kst("2026-10-17", "11:00") });
  assert.throws(() => act(changes, "request", { now: kst("2026-10-17", "12:00") }), (error) => error.code === "REPLY_REQUIRED");
  const replied = act(changes, "request", { now: kst("2026-10-17", "12:00"), reply: "지금 제목이 맞다고 봐요" });
  assert.equal(replied.yp.gates.topic.pdReply, "지금 제목이 맞다고 봐요");
  const edited = { ...changes, yp: { ...changes.yp, contentUpdatedAt: kst("2026-10-17", "11:30") } };
  assert.equal(act(edited, "request", { now: kst("2026-10-17", "12:00") }).yp.gates.topic.state, "wait");
});

test("cancel restores what was there before the request; hold needs a reason", () => {
  const changes = act(act(project(), "request"), "changes", { actor: "ceo", fields: ["topic.note"], memo: "메모" });
  const again = act({ ...changes, yp: { ...changes.yp, contentUpdatedAt: kst("2026-10-18", "09:00") } }, "request", { now: kst("2026-10-18", "10:00") });
  const cancelled = act(again, "cancel");
  assert.equal(cancelled.yp.gates.topic.state, "changes");
  assert.deepEqual(cancelled.yp.gates.topic.fields, ["topic.note"]);
  assert.throws(() => act(act(project(), "request"), "hold", { reason: "" }), /보류 사유/);
  assert.equal(act(act(project(), "request"), "hold", { reason: "다음 달에" }).yp.gates.topic.state, "hold");
});

test("an approver can take back an OK; confirming again returns to where the project was", () => {
  const ok = act(act(project(), "request"), "ok", { actor: "ceo" });
  const outlineStage = { ...ok, yp: { ...ok.yp, stage: "outline" } };
  const reverted = act(outlineStage, "revert", { actor: "ceo" });
  assert.equal(reverted.yp.stage, "topic");
  assert.equal(reverted.yp.gates.topic.state, "wait");
  assert.throws(() => act(reverted, "cancel"), /취소할 수 없어요/);
  assert.equal(act(reverted, "ok", { actor: "ceo" }).yp.stage, "outline");
  assert.throws(() => act(project(), "revert"), /OK만/);
});

test("reminders: 6 hours later, but never 22:00–08:00 KST (수용 7)", () => {
  assert.equal(quietHours(kst("2026-10-17", "22:30")), true);
  assert.equal(quietHours(kst("2026-10-17", "08:00")), false);
  // A 22:30 request is first announced at 08:00 the next morning.
  assert.equal(firstRemindAt(kst("2026-10-17", "22:30")), kst("2026-10-18", "08:00"));
  assert.equal(firstRemindAt(kst("2026-10-18", "03:00")), kst("2026-10-18", "08:00"));
  assert.equal(nextRemindAt(kst("2026-10-17", "10:00")), kst("2026-10-17", "16:00"));
  assert.equal(nextRemindAt(kst("2026-10-17", "17:00")), kst("2026-10-18", "08:00"));
  // Requests made overnight all fall due together at 08:00 → one batch notification.
  const a = act(project("a"), "request", { now: kst("2026-10-17", "22:30") });
  const b = act(project("b"), "request", { now: kst("2026-10-18", "01:10") });
  assert.equal(dueReminders([a, b], kst("2026-10-18", "07:45")).length, 0);
  assert.equal(dueReminders([a, b], kst("2026-10-18", "08:45")).length, 2);
});

test("the confirm menu: waiting oldest first, my decisions, holds", () => {
  const first = act(project("a"), "request", { now: kst("2026-10-17", "09:00") });
  const second = act(project("b"), "request", { now: kst("2026-10-17", "11:00") });
  const decided = act(act(project("c"), "request"), "ok", { actor: "ceo" });
  const held = act(act(project("d"), "request"), "hold", { actor: "ceo", reason: "보류" });
  assert.deepEqual(confirmTab([second, first, decided, held], "wait", "ceo").map(row => row.project.id), ["a", "b"]);
  assert.deepEqual(confirmTab([second, first, decided, held], "done", "ceo").map(row => row.project.id), ["c"]);
  assert.deepEqual(confirmTab([second, first, decided, held], "hold", "ceo").map(row => row.project.id), ["d"]);
});
