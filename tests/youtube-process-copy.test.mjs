import assert from "node:assert/strict";
import test from "node:test";
import { COPIED_STAGES, copiedMake, copiedMeta } from "../lib/youtube-process/copy.ts";
import { emptyGates, newProjectMeta } from "../lib/youtube-process/project.ts";
import { emptyStage } from "../lib/youtube-process/stages.ts";

// 영상 복제 (owner decision 2026-10-28, 「같은 단계 그대로」).
test("a copy keeps its step up to 제작, the 주제 · 기획안 컨펌, and leaves everything after the video", () => {
  const yp = newProjectMeta({ type: "anim", target: "t", note: "", refs: [] }, "2026-10-20T00:00:00Z").yp;
  const ok = { state: "ok", round: 1, at: "2026-10-21T00:00:00Z", by: "u1" };
  const before = { ...yp, stage: "outline", gates: { ...emptyGates(), topic: ok, draft: ok } };
  const copy = copiedMeta(before, "2026-10-28T00:00:00Z");
  assert.equal(copy.stage, "outline", "the same step");
  assert.deepEqual([copy.gates.topic, copy.gates.draft], [ok, ok], "주제 · 기획안 컨펌 come along");
  assert.equal(copy.contentUpdatedAt, "2026-10-28T00:00:00Z");
  for (const stage of ["review", "upload", "shorts", "done"]) {
    const later = copiedMeta({ ...before, stage, gates: { ...before.gates, review: ok, shorts: ok }, shortsLog: [{ at: "x" }], shortsConfirmed: { at: "x", by: "u", clips: {} } }, "2026-10-28T00:00:00Z");
    assert.equal(later.stage, "make", `${stage}: the video is made again, so the copy starts at 제작`);
    assert.deepEqual([later.gates.review, later.gates.shorts], [emptyGates().review, emptyGates().shorts], "최종 검토 · 쇼츠 컨펌 start over");
    assert.equal("shortsLog" in later || "shortsConfirmed" in later, false);
  }
  assert.deepEqual([...COPIED_STAGES], ["plan", "outline", "make", "shortScript"]);
});

test("a copy's 제작 keeps the schedule and thumbnails, not the uploaded video or its production status", () => {
  const make = { ...emptyStage("make", "anim"), editDue: "2026-11-01", status: "done", statusAt: { done: "x" }, log: [{ at: "x", by: "u", from: "a", to: "b", why: "" }],
    finals: [{ v: 1 }], thumbs: { A: { path: "p", at: "x", name: "a.png" } } };
  const copy = copiedMake(make);
  assert.deepEqual([copy.status, copy.statusAt, copy.log, copy.finals], ["prep", {}, [], []]);
  assert.equal(copy.editDue, "2026-11-01");
  assert.deepEqual(copy.thumbs, make.thumbs);
});
