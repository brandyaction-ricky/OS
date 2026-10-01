import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as zod from "zod";

const kitId = "4c345370-6af6-425a-9b28-c769f7ee9a30";
const sourceId = "56d9ff8b-acde-4b95-8d8f-91b395643854";
const route = await readFile(new URL("../app/api/v1/youtube/upload/session/route.ts", import.meta.url), "utf8");
const code = ts.transpileModule(route, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function setup(options = {}) {
  const controls = { releaseApproved: false, approved: [true, true, true], approvedChannel: "channel-a", approvedPrivacy: "private", connectedChannel: "channel-a", ...options };
  const rows = [
    { id: kitId, record_type: "content_package", title: "발행 키트", parent_id: sourceId, archived_at: null, metadata: { packageKind: "youtube_kit", result: { title: "영상 제목" } } },
    { id: sourceId, record_type: "content_topic", archived_at: null, metadata: { pipelineEnabled: true } },
  ];
  const actor = { id: "admin", role: "admin", supabase: { from() {
    const filters = [];
    const builder = { select() { return builder; }, eq(key, value) { filters.push((row) => row[key] === value); return builder; }, is(key, value) { filters.push((row) => row[key] === value); return builder; }, async maybeSingle() { return { data: structuredClone(rows.find((row) => filters.every((match) => match(row))) ?? null), error: null }; } };
    return builder;
  } } };
  const modules = {
    "next/server": { NextResponse: Response }, zod,
    "@/lib/http": { ApiError, parseJson: (request) => request.json(), apiErrorResponse: (error) => Response.json({ code: error.code }, { status: error.status ?? 500 }) },
    "@/lib/server/auth": { authenticateRequest: async () => actor },
    "@/lib/server/content-pipeline": { readPipeline: async () => ({ approved: controls.approved, release: { approved: controls.releaseApproved, plan: { channelId: controls.approvedChannel, privacyStatus: controls.approvedPrivacy } } }) },
    "@/lib/server/youtube-oauth": { youtubeConnectionStatus: async () => ({ channelId: controls.connectedChannel, channelTitle: "Main" }), getYoutubeAccessToken: async () => "token" },
  };
  const commonJsModule = { exports: {} }; let fetchCount = 0;
  runInNewContext(`(function(require, module, exports) { ${code}\n})`, { Response, URLSearchParams, fetch: async () => { fetchCount++; return new Response(null, { status: 200, headers: { location: "https://upload.example/session" } }); } })((key) => modules[key], commonJsModule, commonJsModule.exports);
  const post = (privacyStatus = "private") => commonJsModule.exports.POST(new Request("https://os.example/api/v1/youtube/upload/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kitId, fileName: "final.mp4", fileSize: 1024, mimeType: "video/mp4", privacyStatus, finalApproval: true }) }));
  return { controls, post, fetchCount: () => fetchCount };
}

test("pipeline video upload requires a persisted release approval", async () => {
  const state = setup();
  const response = await state.post();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "RELEASE_APPROVAL_REQUIRED");
  assert.equal(state.fetchCount(), 0);
});

test("changed channel or privacy invalidates the upload before contacting YouTube", async () => {
  for (const options of [{ releaseApproved: true, connectedChannel: "channel-b" }, { releaseApproved: true, approvedPrivacy: "private" }]) {
    const state = setup(options);
    const response = await state.post(options.connectedChannel ? "private" : "unlisted");
    assert.equal(response.status, 409);
    assert.equal(state.fetchCount(), 0);
  }
});

test("current final review and matching release approval create the upload session", async () => {
  const state = setup({ releaseApproved: true });
  const response = await state.post();
  assert.equal(response.status, 200);
  assert.equal(state.fetchCount(), 1);
  assert.equal((await response.json()).channelId, "channel-a");
});
