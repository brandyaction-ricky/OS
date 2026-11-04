import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as kosis from "../lib/kosis.ts";

// 로건 개발 문서 「OS 영상 편집기」 (2026-11-03) §4-2: the AI that edits a finished video first reads it — read only, its own videos only.
const compiled = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/server/mcp.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module: compiled, exports: compiled.exports, require: (name) => { if (name === "zod") return { z }; if (name === "../kosis.ts") return kosis; throw Error(name); }, URLSearchParams, encodeURIComponent });
const { MCP_TOOLS, callMcpTool } = compiled.exports;
const project = "33333333-3333-4333-8333-333333333333";

test("get_video_editor is read only and asks the editor route for one view", async () => {
  const tool = MCP_TOOLS.find((item) => item.name === "get_video_editor");
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.deepEqual([...tool.inputSchema.properties.view.enum], ["summary", "scenes", "subtitles", "assets", "orders"]);
  const calls = [];
  await callMcpTool({ name: "get_video_editor", arguments: { project_id: project, view: "orders" } }, "org", async (path, init) => { calls.push([path, init?.method ?? "GET"]); return {}; });
  await callMcpTool({ name: "get_video_editor", arguments: { project_id: project } }, "org", async (path) => { calls.push([path, "GET"]); return {}; });
  assert.deepEqual(calls, [[`/api/v1/content/youtube-automation/editor?projectId=${project}&view=orders`, "GET"], [`/api/v1/content/youtube-automation/editor?projectId=${project}&view=summary`, "GET"]]);
  await assert.rejects(callMcpTool({ name: "get_video_editor", arguments: { project_id: "x" } }, "org", async () => ({})));
});

test("an AI key reads only a video its owner made or is assigned, and nothing is written", async () => {
  const route = await readFile(new URL("../app/api/v1/content/youtube-automation/editor/route.ts", import.meta.url), "utf8");
  assert.match(route, /authenticateRequest\(request, \{ allowAgent: true, requiredAgentScope: "knowledge\.read" \}\)/);
  assert.match(route, /actor\.type === "agent" && project\.ownerId !== actor\.ownerId && project\.assigneeId !== actor\.ownerId/, "an AI key's database client is not scoped");
  assert.doesNotMatch(route, /export async function (POST|PATCH|PUT|DELETE)/);
  assert.match(route, /item\.target === "video" && item\.status === "open" && !item\.deleted/, "orders = open 최종 검토 feedback on the video");
  const run = await readFile(new URL("../lib/server/myin-run.ts", import.meta.url), "utf8");
  const view = run.slice(run.indexOf("export async function myinEditorView"));
  assert.doesNotMatch(view, /save\(|\.upload\(|\.remove\(|createSigned/, "reading changes nothing");
  assert.match(view, /myinSceneStarts\(story\.scenes, words\)/, "each scene says when it starts in the voice");
});
