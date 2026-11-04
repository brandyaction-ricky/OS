import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as kosis from "../lib/kosis.ts";
import { EDIT_LOCK_STALE_MS, editCheckIssues, editFeed, lockDecision, orderMove } from "../lib/myin-edit.ts";

// 로건 개발 문서 v2 「OS 영상 편집기」 (2026-11-04) ②-2: one editor per video (the lock), orders from members' AI chats wait for it.
const compiled = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/server/mcp.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module: compiled, exports: compiled.exports, require: (name) => { if (name === "zod") return { z }; if (name === "../kosis.ts") return kosis; throw Error(name); }, URLSearchParams, encodeURIComponent });
const { MCP_TOOLS, callMcpTool } = compiled.exports;
const project = "33333333-3333-4333-8333-333333333333", order = "44444444-4444-4444-8444-444444444444", feedback = "55555555-5555-4555-8555-555555555555";
const now = Date.parse("2026-11-04T12:00:00Z");
const lock = { by: "a", name: "유쓰", pc: "mac", since: "2026-11-04T11:00:00Z", seenAt: new Date(now - 60_000).toISOString(), basedOn: null };

test("one editor per video: the same person on the same computer renews, anyone else only watches, a silent lock frees the video", () => {
  assert.equal(lockDecision(null, { by: "a", pc: "mac" }, now).kind, "take");
  assert.equal(lockDecision(lock, { by: "a", pc: "mac" }, now).kind, "renew");
  assert.equal(lockDecision(lock, { by: "b", pc: "win" }, now).kind, "held");
  assert.equal(lockDecision(lock, { by: "a", pc: "office" }, now).kind, "held", "my other computer waits too");
  assert.equal(lockDecision({ ...lock, seenAt: new Date(now - EDIT_LOCK_STALE_MS - 1).toISOString() }, { by: "b", pc: "win" }, now).kind, "take");
});

test("an order only moves forward; done and 못 함 are final", () => {
  assert.ok(orderMove("queued", "working") && orderMove("working", "done") && orderMove("working", "failed") && orderMove("failed", "queued") && orderMove("queued", "declined"));
  assert.ok(!orderMove("queued", "done") && !orderMove("done", "declined") && !orderMove("declined", "queued") && !orderMove("done", "queued"));
});

test("submit_video_edit and decline_video_order post to the editor route", async () => {
  for (const name of ["submit_video_edit", "decline_video_order"]) assert.equal(MCP_TOOLS.find((t) => t.name === name).annotations.readOnlyHint, false);
  const calls = [];
  const api = async (path, init) => { calls.push([path, init.method, JSON.parse(init.body)]); return {}; };
  await callMcpTool({ name: "submit_video_edit", arguments: { project_id: project, text: "3번 장면 사진 바꿔줘", at: "1:23", meaning: "3번 장면 사진 → 회의실", storyboard: { scenes: [] }, feedback_ids: [feedback] } }, "org", api);
  await callMcpTool({ name: "decline_video_order", arguments: { project_id: project, order_id: order, reason: "그 장면은 음성이 없어요" } }, "org", api);
  assert.deepEqual(calls.map(([p, m, b]) => [p, m, b.action, b.projectId]), [["/api/v1/content/youtube-automation/editor", "POST", "order", project], ["/api/v1/content/youtube-automation/editor", "POST", "decline", project]]);
  assert.deepEqual(calls[0][2].feedbackIds, [feedback]);
  assert.equal(calls[1][2].orderId, order);
  await assert.rejects(callMcpTool({ name: "submit_video_edit", arguments: { project_id: project } }, "org", api), "the person's words are required");
});

test("writes need records.write, an order passes the storyboard check, and only the lock holder takes or answers orders", async () => {
  const route = await readFile(new URL("../app/api/v1/content/youtube-automation/editor/route.ts", import.meta.url), "utf8");
  assert.match(route.slice(route.indexOf("export async function POST")), /requiredAgentScope: "records\.write"/);
  const edit = await readFile(new URL("../lib/server/myin-edit.ts", import.meta.url), "utf8");
  const submit = edit.slice(edit.indexOf("export async function submitEditOrder"), edit.indexOf("async function lockHolder"));
  assert.match(submit, /checkMyinStoryboard\(input\.storyboard, myin\.words, diagramCatalogTypes\(await readDiagramCatalog\(\)\), myin\.speech\)/);
  assert.match(submit, /ApiError\(422, "EDIT_STORYBOARD_ISSUES"/);
  for (const fn of ["nextEditOrders", "editOrderResult"]) assert.match(edit.slice(edit.indexOf(`export async function ${fn}`)).split("\nexport ")[0], /await lockHolder\(service, actor, project\.id, pc\)/, fn);
  assert.match(edit, /\.eq\("id", record\.id\)\.eq\("version", record\.version\)/, "the lock is taken with the record version");
  assert.match(edit.slice(edit.indexOf("export async function declineEdit")), /action: "decline", text: input\.reason/, "a declined feedback keeps the reason");
});

test("확정 전 자동 검사: no decode errors, frames = length × 60 (±1), sound and picture the same length", () => {
  const ok = { decodeErrors: 0, frames: 36_000, end: 600, videoSeconds: 600, audioSeconds: 600.02 };
  assert.deepEqual(editCheckIssues(ok), []);
  assert.deepEqual(editCheckIssues({ ...ok, frames: 36_001 }), [], "one frame off is fine");
  assert.match(editCheckIssues({ ...ok, frames: 35_998 })[0], /프레임 수 35998 \/ 예상 36000/);
  assert.match(editCheckIssues({ ...ok, decodeErrors: 2 })[0], /디코드 오류 2건/);
  assert.match(editCheckIssues({ ...ok, audioSeconds: 600.06 })[0], /소리·화면 길이/);
});

test("a confirm lands only from the newest final, after the check, with the engine kept and every file up", async () => {
  const edit = await readFile(new URL("../lib/server/myin-edit.ts", import.meta.url), "utf8");
  const start = edit.slice(edit.indexOf("export async function confirmStart"), edit.indexOf("export async function confirmFinish"));
  assert.match(start, /await heldSession\(service, actor, project\.id, input\.pc\)/, "only the editor holding the lock");
  assert.match(start, /lock\.basedOn !== base\) throw new ApiError\(409, "EDIT_BASE_MOVED"/, "someone else confirmed first");
  assert.match(start, /editCheckIssues\(input\.check\)/);
  assert.match(start, /await engineBundleSaved\(input\.engine\)/, "the engine another computer installs to go on");
  const finish = edit.slice(edit.indexOf("export async function confirmFinish"), edit.indexOf("export async function editHandoff"));
  assert.match(finish, /sizes\.get\(.*\) !== part\.bytes/, "every bundle part is up at its size");
  assert.match(finish, /basedOn: final\.at/, "the editor goes on from its own confirm");
  const run = await readFile(new URL("../lib/server/myin-run.ts", import.meta.url), "utf8");
  const add = run.slice(run.indexOf("export async function myinAddEditFinal"), run.indexOf("export async function myinFinalForHandoff"));
  assert.match(add, /run\.final\?\.at !== input\.basedOn/, "checked again at the moment it lands");
  assert.match(add, /record\.stage !== "final_ready"/, "not while the OS makes the video again");
  assert.match(add, /!== input\.bytes\) throw/, "the uploaded video is the one measured");
  assert.match(add, /retireFinal\(next\)/, "the final before it stays a version");
  assert.match(run, /\.eq\("id", record\.id\)\.eq\("version", record\.version\)/, "two confirms cannot both land");
  const engine = await readFile(new URL("../lib/server/render-engine.ts", import.meta.url), "utf8");
  assert.doesNotMatch(engine, /\.remove\(/, "no engine bundle is ever deleted");
});

test("confirm and handoff go through the editor route", async () => {
  const route = await readFile(new URL("../app/api/v1/content/youtube-automation/editor/route.ts", import.meta.url), "utf8");
  for (const action of ["confirm_start", "confirm_finish", "handoff"]) assert.match(route, new RegExp(`action === "${action}"`));
});

test("편집 소식: what happened since a time, oldest first, in words the AI chat passes on", async () => {
  const state = { lock: { name: "로건", pc: "로건 PC", since: "2026-11-04T05:00:00.000Z" }, uploadedAt: null,
    versions: [{ at: "2026-11-03T10:00:00.000Z", edit: null }, { at: "2026-11-04T06:00:00.000Z", edit: { name: "로건", pc: "로건 PC", orders: 2 } }],
    orders: [{ at: "2026-11-04T05:10:00.000Z", updatedAt: "2026-11-04T05:30:00.000Z", text: "사진 바꿔줘", name: "유쓰", from: "chat", status: "done", result: { version: "v4", note: "", at: "2026-11-04T05:30:00.000Z" } },
      { at: "2026-11-04T05:20:00.000Z", updatedAt: "2026-11-04T05:21:00.000Z", text: "음악 밝게", name: "대표", from: "feedback", status: "declined", result: { note: "엔진에 없는 연출이에요", at: "2026-11-04T05:21:00.000Z" } },
      { at: "2026-11-04T05:40:00.000Z", updatedAt: "2026-11-04T05:41:00.000Z", text: "자막 오타", name: "로건", from: "chat", status: "working", result: null }] };
  const all = editFeed(state, null);
  assert.deepEqual(all.map((e) => e.kind), ["editing", "order", "order", "declined", "done", "order", "working", "confirmed"]);
  assert.match(all.find((e) => e.kind === "declined").text, /“음악 밝게”은 할 수 없어요: 엔진에 없는 연출이에요/);
  assert.match(all.at(-1).text, /로건님이 로건 PC에서 완성해 새 완성본이 올라왔어요\(주문 2건\)/);
  assert.ok(all.every((e) => !/v\d/.test(e.text)), "no version numbers in what people hear (doc v3 P10)");
  assert.deepEqual(editFeed(state, "2026-11-04T05:35:00.000Z").map((e) => e.kind), ["order", "working", "confirmed"]);
  const route = await readFile(new URL("../app/api/v1/content/youtube-automation/editor/route.ts", import.meta.url), "utf8");
  assert.match(route, /input\.view === "feed"\) return NextResponse\.json\(\{ title: project\.title, \.\.\.await editNews\(actor, project\.id, input\.since \?\? null\)/);
  const calls = [];
  await callMcpTool({ name: "get_video_editor", arguments: { project_id: project, view: "feed", since: "2026-11-04T05:35:00.000Z" } }, "org", async (path) => { calls.push(path); return {}; });
  assert.equal(calls[0], `/api/v1/content/youtube-automation/editor?projectId=${project}&view=feed&since=2026-11-04T05%3A35%3A00.000Z`);
});
