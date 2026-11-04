import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as kosis from "../lib/kosis.ts";
import { EDIT_LOCK_STALE_MS, lockDecision, orderMove } from "../lib/myin-edit.ts";

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
