import assert from "node:assert/strict";
import test from "node:test";
import { applyGateAction, confirmTab, GATE_NAME } from "../lib/youtube-process/confirm.ts";
import { nextAction } from "../lib/youtube-process/next.ts";
import { newProjectMeta, projectFromRecord } from "../lib/youtube-process/project.ts";
import { clipConfirmed, clipParts, clipScriptProblems, clipSeconds, clipSignature, formatParts, parseParts, partsCuts } from "../lib/youtube-process/short.ts";

// 쇼츠 컨펌 (owner request 2026-10-25): the 대표 confirms the shorts scripts in 쇼츠 · 칼럼; only confirmed, unchanged scripts are made and uploaded.
const now = "2026-10-25T03:00:00Z";
const meta = (stage) => ({ ...newProjectMeta({ type: "anim", target: "t", note: "", refs: [] }, now).yp, stage });
const at = (minutes) => new Date(Date.parse(now) + minutes * 60_000).toISOString();

test("projects made before the gate read 쇼츠 컨펌 as not requested", () => {
  const old = meta("shorts"); delete old.gates.shorts;
  const project = projectFromRecord({ id: "p", version: 1, title: "t", owner_id: "o", updated_at: now, metadata: { workflow: "youtube_v1", yp: old } });
  assert.deepEqual(project.yp.gates.shorts, { state: "none", round: 0 });
  assert.equal(GATE_NAME.shorts, "쇼츠 컨펌");
});

test("쇼츠 컨펌 is asked in 쇼츠 · 칼럼, stays there on OK, and can be asked again after an OK", () => {
  assert.throws(() => applyGateAction({ yp: meta("upload") }, "shorts", "request", { actor: "pd", now }), /요청할 수 없어요/);
  let yp = applyGateAction({ yp: meta("shorts") }, "shorts", "request", { actor: "pd", now });
  assert.equal(yp.gates.shorts.state, "wait");
  assert.equal(nextAction({ id: "p", yp }).tone, "wait");
  assert.equal(confirmTab([{ yp }], "wait", "ceo").length, 1);
  yp = applyGateAction({ yp }, "shorts", "ok", { actor: "ceo", now: at(5) });
  assert.equal(yp.gates.shorts.state, "ok");
  assert.equal(yp.stage, "shorts");
  // New or changed scripts: a second request is allowed, and a 수정 요청 can be answered without a reason (the scripts live in their own records).
  yp = applyGateAction({ yp }, "shorts", "request", { actor: "pd", now: at(10) });
  yp = applyGateAction({ yp }, "shorts", "changes", { actor: "ceo", now: at(15), fields: ["shorts.copy"], memo: "제목을 더 짧게" });
  yp = applyGateAction({ yp }, "shorts", "request", { actor: "pd", now: at(20) });
  assert.equal(yp.gates.shorts.state, "wait");
  assert.equal(yp.gates.shorts.round, 3);
});

test("a script is confirmed only as it was confirmed: any change to copy, first 3 seconds, parts or description needs a new OK", () => {
  const clip = { id: "c1", title: "열심히의 함정", metadata: { hook: "차이는 딱 하나예요", desc: "설명 #창업", segments: [{ start: 330, end: 336 }, { start: 130, end: 170 }] } };
  const confirmed = { at: now, clips: { c1: clipSignature(clip) } };
  assert.equal(clipConfirmed(confirmed, true, clip), true);
  assert.equal(clipConfirmed(confirmed, false, clip), false, "the gate must be OK (a 되돌리기 or a new request stops it)");
  assert.equal(clipConfirmed(confirmed, true, { ...clip, title: "열심히의 함정 2" }), false);
  assert.equal(clipConfirmed(confirmed, true, { ...clip, metadata: { ...clip.metadata, segments: [{ start: 330, end: 337 }] } }), false);
  assert.equal(clipConfirmed(confirmed, true, { ...clip, id: "c2" }), false);
  // Uploading writes the Short's link onto the clip; that is not a script change.
  assert.equal(clipConfirmed(confirmed, true, { ...clip, metadata: { ...clip.metadata, youtube: { videoId: "x" } } }), true);
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
