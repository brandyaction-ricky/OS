import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PIN_AFTER_MS, pinFrom, studioSettled, studioStates, testKind } from "../lib/youtube-process/studio.ts";

// 스튜디오 작업 (2026-11-06 staff request): 최종 화면 · 테스트 및 비교 · 고정 댓글 queued after a longform upload for the uploader's own AI in Studio.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const AT = "2026-11-06T09:00:00.000Z", PUBLISH = "2026-11-07T09:00:00.000Z";

test("a scheduled video's pin waits for its publish time and five minutes; a public one is ready, a private one waits for a person", () => {
  const scheduled = { privacy: "private", publishAt: PUBLISH, at: AT };
  assert.equal(pinFrom(scheduled), new Date(Date.parse(PUBLISH) + PIN_AFTER_MS).toISOString());
  assert.equal(studioStates({ reports: {} }, scheduled, "썸네일만", Date.parse(PUBLISH)).pin.state, "later", "not at the publish minute");
  assert.equal(studioStates({ reports: {} }, scheduled, "썸네일만", Date.parse(PUBLISH) + PIN_AFTER_MS).pin.state, "ready");
  assert.equal(studioStates({ reports: {} }, { privacy: "public", at: AT }, "", Date.parse(AT)).pin.state, "ready");
  const hidden = studioStates({ reports: {} }, { privacy: "private", at: AT }, "", Date.parse(AT) + 864e5);
  assert.deepEqual([hidden.pin.state, hidden.pin.from], ["later", null], "private without a schedule: 공개한 뒤에");
});

test("end screen and test are ready at once; reports settle them, a test without B · C has nothing to do", () => {
  const video = { privacy: "private", publishAt: PUBLISH, at: AT };
  const now = studioStates({ reports: {} }, video, "제목과 썸네일", Date.parse(AT));
  assert.deepEqual([now.endscreen.state, now.test.state], ["ready", "ready"], "a private video takes its end screen and test before it is public");
  const reports = { endscreen: { done: true, at: AT, by: "u", name: "PD", note: "" }, test: { done: false, at: AT, by: "u", name: "PD", note: "B 썸네일이 없어요" } };
  const after = studioStates({ reports }, video, "제목과 썸네일", Date.parse(AT));
  assert.deepEqual([after.endscreen.state, after.test.state, after.test.note], ["done", "failed", "B 썸네일이 없어요"]);
  assert.equal(studioSettled(after), false, "the pin still waits");
  assert.equal(studioStates({ reports: {} }, video, "", Date.parse(AT)).test.state, "none");
  assert.equal(studioSettled(studioStates({ reports: { ...reports, pin: { done: true, at: PUBLISH, by: "u", name: "PD", note: "" } } }, video, "제목과 썸네일", Date.parse(PUBLISH) + PIN_AFTER_MS)), true);
});

test("the test kind follows the confirmed pairs", () => {
  const plan = { confirmed: { at: AT, A: { title: "가", thumb: { copy: "x" } }, B: { title: "나", thumb: { copy: "x" } } } };
  assert.equal(testKind(plan, { thumbs: { A: { path: "a" }, B: { path: "a" } } }), "제목만");
  assert.equal(testKind(plan, { thumbs: { A: { path: "a" }, B: { path: "b" } } }), "제목과 썸네일");
  assert.equal(testKind({ confirmed: { at: AT, A: plan.confirmed.A } }, { thumbs: {} }), "");
});

test("the OS queues it after a longform upload, never touches Studio, and an AI key reaches only its owner's videos", () => {
  const upload = read("lib/server/youtube-process-upload.ts");
  assert.match(upload, /if \(!short\) await queueStudioTask\(service, project\.id, video\.id,/, "a Short has no end screen or test");
  const studio = read("lib/server/youtube-studio.ts");
  assert.doesNotMatch(studio, /googleapis\.com/, "Studio work is done by the person's own AI, not the server");
  assert.match(studio, /actor\.type === "agent" && !\[project\.ownerId, project\.assigneeId, record\?\.created_by\]\.includes\(actor\.ownerId\)/);
  assert.match(studio, /if \(decision\.kind === "held"\) throw new ApiError\(409, "STUDIO_TASK_BUSY"/, "one person at a time");
  assert.match(studio, /notify\([^\n]*"yt_due", project\.id, `studio-pin:\$\{project\.id\}`\)/, "the pin's time is told once");
  assert.match(read("app/api/v1/content/youtube/cron/route.ts"), /\.\.\.await remindStudioPins\(\)/);
});

test("two MCP tools reach the route: read (start takes it) and report", () => {
  const mcp = read("lib/server/mcp.ts");
  for (const name of ["get_upload_studio_task", "report_studio_done"]) assert.match(mcp, new RegExp(`name: "${name}"`));
  assert.match(mcp, /view: "task", \.\.\.\(input\.start \? \{ start: "1" \} : \{\}\)/);
  assert.match(mcp, /action: "report", projectId: input\.project_id, item: input\.item, done: input\.done/);
  const route = read("app/api/v1/content/youtube/studio/route.ts");
  assert.match(route, /requiredAgentScope: "knowledge\.read"/);
  assert.match(route, /requiredAgentScope: "records\.write"/);
});
