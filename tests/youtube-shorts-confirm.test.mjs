import assert from "node:assert/strict";
import test from "node:test";
import { applyGateAction, confirmTab, GATE_NAME } from "../lib/youtube-process/confirm.ts";
import { nextAction } from "../lib/youtube-process/next.ts";
import { newProjectMeta, projectFromRecord } from "../lib/youtube-process/project.ts";
import { clipConfirmed, clipParts, clipScriptProblems, clipSeconds, clipSignature, formatParts, parseParts, partsCuts, shortsAction } from "../lib/youtube-process/short.ts";

// 쇼츠 확정 (owner decision 2026-10-25): the PD confirms the shorts scripts in 쇼츠 · 칼럼; the 대표 reads the record in 대표 메뉴 › 컨펌
// and comments. Only confirmed, unchanged scripts are made and uploaded.
const now = "2026-10-25T03:00:00Z";
const meta = (stage) => ({ ...newProjectMeta({ type: "anim", target: "t", note: "", refs: [] }, now).yp, stage });
const at = (minutes) => new Date(Date.parse(now) + minutes * 60_000).toISOString();

test("projects made before the gate read 쇼츠 확정 as not done", () => {
  const old = meta("shorts"); delete old.gates.shorts;
  const project = projectFromRecord({ id: "p", version: 1, title: "t", owner_id: "o", updated_at: now, metadata: { workflow: "youtube_v1", yp: old } });
  assert.deepEqual(project.yp.gates.shorts, { state: "none", round: 0 });
  assert.equal(project.yp.shortsConfirmed, undefined);
});

const pd = { id: "pd", name: "리키" }, ceo = { id: "ceo", name: "대표" };
const script = (id, extra = {}) => ({ id, title: "열심히의 함정", metadata: { hook: "차이는 딱 하나예요", desc: "설명 #창업", segments: [{ start: 330, end: 336 }], ...extra } });

test("the PD confirms the picked scripts at once; nothing waits on the 대표 and the gate never shows in the wait list", () => {
  assert.throws(() => shortsAction(meta("shorts"), { action: "confirm", clips: [] }, pd, now), /채택해 주세요/);
  assert.throws(() => shortsAction(meta("shorts"), { action: "confirm", clips: [script("c1", { desc: "" })] }, pd, now), /설명/);
  let yp = shortsAction(meta("shorts"), { action: "confirm", note: "", clips: [script("c1"), script("c2")] }, pd, now);
  assert.equal(yp.gates.shorts.state, "ok");
  assert.equal(yp.gates.shorts.decidedBy, "pd");
  assert.deepEqual(Object.keys(yp.shortsConfirmed.clips), ["c1", "c2"]);
  assert.deepEqual(yp.shortsLog.map(entry => [entry.kind, entry.byName, entry.count]), [["confirm", "리키", 2]]);
  assert.equal(nextAction({ id: "p", yp }).tone, "todo");
  assert.equal(confirmTab([{ yp }], "wait", "ceo").length, 0);
  assert.equal(confirmTab([{ yp }], "done", "ceo").length, 0);
  // Confirming the same scripts again says there is nothing new; a changed one confirms again with the note in the record.
  assert.throws(() => shortsAction(yp, { action: "confirm", clips: [script("c1"), script("c2")] }, pd, at(1)), /새로 확정할 쇼츠가 없어요/);
  yp = shortsAction(yp, { action: "confirm", note: "c2 첫 3초 바꿈", clips: [script("c1"), script("c2", { hook: "새 첫 문장" })] }, pd, at(2));
  assert.equal(yp.gates.shorts.round, 2);
  assert.equal(yp.shortsLog.at(-1).text, "c2 첫 3초 바꿈");
});

test("the 대표 reads every 확정 record in 쇼츠 확정 (newest first) and comments; a comment does not change what is confirmed", () => {
  const first = shortsAction(meta("shorts"), { action: "confirm", clips: [script("c1")] }, pd, now);
  const second = shortsAction(meta("shorts"), { action: "confirm", clips: [script("c9")] }, pd, at(30));
  const commented = shortsAction(first, { action: "comment", text: "  제목을 더 짧게  " }, ceo, at(60));
  assert.deepEqual(commented.shortsConfirmed, first.shortsConfirmed);
  assert.deepEqual(commented.shortsLog.map(entry => [entry.kind, entry.byName, entry.text]), [["confirm", "리키", ""], ["comment", "대표", "제목을 더 짧게"]]);
  const rows = confirmTab([{ id: "a", yp: second }, { id: "b", yp: commented }, { id: "c", yp: meta("shorts") }], "shorts", "ceo");
  assert.deepEqual(rows.map(row => row.project.id), ["b", "a"]);
  assert.equal(GATE_NAME.shorts, "쇼츠 확정");
  // The approver's gates stay as they were: 쇼츠 확정 cannot be requested or waited on.
  assert.throws(() => applyGateAction({ yp: commented }, "shorts", "request", { actor: "pd", now }), /요청할 수 없어요/);
});

test("a script is confirmed only as it was confirmed: any change to copy, first 3 seconds, parts or description needs a new 확정", () => {
  const clip = { id: "c1", title: "열심히의 함정", metadata: { hook: "차이는 딱 하나예요", desc: "설명 #창업", segments: [{ start: 330, end: 336 }, { start: 130, end: 170 }] } };
  const confirmed = { at: now, by: "pd", clips: { c1: clipSignature(clip) } };
  assert.equal(clipConfirmed(confirmed, clip), true);
  assert.equal(clipConfirmed(undefined, clip), false);
  assert.equal(clipConfirmed(confirmed, { ...clip, title: "열심히의 함정 2" }), false);
  assert.equal(clipConfirmed(confirmed, { ...clip, metadata: { ...clip.metadata, segments: [{ start: 330, end: 337 }] } }), false);
  assert.equal(clipConfirmed(confirmed, { ...clip, id: "c2" }), false);
  // Uploading writes the Short's link onto the clip; that is not a script change.
  assert.equal(clipConfirmed(confirmed, { ...clip, metadata: { ...clip.metadata, youtube: { videoId: "x" } } }), true);
});

test("parts: the old single range still reads, the screen's text round-trips, and the script problems are named", () => {
  assert.deepEqual(clipParts({ start: 12, end: 40 }), [{ start: 12, end: 40 }]);
  const parts = parseParts("05:30-05:36, 2:10 ~ 2:50.5");
  assert.deepEqual(parts, [{ start: 330, end: 336 }, { start: 130, end: 170.5 }]);
  assert.equal(formatParts(parts), "05:30-05:36, 02:10-02:50.5");
  assert.equal(clipSeconds(parts), 46.5);
  assert.equal(parseParts("05:30-05:20"), null);
  assert.deepEqual(clipScriptProblems({ title: "", metadata: { segments: [{ start: 0, end: 70 }] } }), ["제목", "설명", "70초 (60초 이내)"]);
  assert.deepEqual(clipScriptProblems({ title: "t", metadata: { desc: "d", segments: parts } }), []);
});

test("the parts become cuts in play order, each part from its own place in the final", () => {
  const cues = [{ start: 330, end: 333, text: "차이는" }, { start: 333, end: 336, text: "딱 하나예요" }, { start: 130, end: 170, text: "본론" }];
  const cuts = partsCuts(cues, [{ start: 330, end: 336 }, { start: 130, end: 170 }], "훅");
  assert.deepEqual(cuts.map(cut => [cut.start, cut.end, cut.text]), [["05:30.000", "05:33.000", "차이는"], ["05:33.000", "05:36.000", "딱 하나예요"], ["02:10.000", "02:50.000", "본론"]]);
});
