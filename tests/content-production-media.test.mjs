import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as zod from "zod";
import * as productionWorkflow from "../lib/content-production-workflow.ts";

const sourceId = "00000000-0000-4000-8000-000000000010";
const uploaderId = "00000000-0000-4000-8000-000000000020";
const routeSource = await readFile(new URL("../app/api/v1/content/media/route.ts", import.meta.url), "utf8");
const routeCode = ts.transpileModule(routeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function setup() {
  const signed = []; const removed = [];
  const actor = { id: uploaderId, role: "member", supabase: { from(table) {
    assert.equal(table, "os_records");
    const query = { select() { return query; }, eq() { return query; }, is() { return query; }, async maybeSingle() {
      return { data: { id: sourceId, record_type: "content_topic", archived_at: null }, error: null };
    } };
    return query;
  } } };
  const storage = { async getBucket() { return { data: { id: "os-content-media" }, error: null }; }, from(bucket) {
    assert.equal(bucket, "os-content-media");
    return {
      async createSignedUploadUrl(path) { signed.push(path); return { data: { token: "upload-token" }, error: null }; },
      async createSignedUrl(path) { signed.push(path); return { data: { signedUrl: `https://private.example/${path}` }, error: null }; },
      async remove(paths) { removed.push(...paths); return { error: null }; },
    };
  } };
  const modules = {
    "node:crypto": crypto,
    "next/server": { NextResponse: { json: (value, init) => Response.json(value, init) } },
    zod,
    "@/lib/content-production-workflow": productionWorkflow,
    "@/lib/http": { ApiError, parseJson: (request) => request.json(), apiErrorResponse: (error) => Response.json({ error: { code: error.code } }, { status: error.status ?? 500 }) },
    "@/lib/server/auth": { authenticateRequest: async () => actor },
    "@/lib/supabase/server": { createServiceSupabase: () => ({ storage }) },
  };
  const commonJsModule = { exports: {} };
  runInNewContext(`(function(require, module, exports) { ${routeCode}\n})`, { Request, Response, Headers, URL, console })((key) => modules[key], commonJsModule, commonJsModule.exports);
  return { api: commonJsModule.exports, actor, signed, removed };
}

test("production files receive scoped private upload paths and preserve logical metadata", async () => {
  const h = setup();
  const response = await h.api.POST(new Request("https://os.example/api/v1/content/media", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceId, assetKind: "voice", fileName: "한국어 보이스.mp3", fileSize: 1024, mimeType: "audio/mpeg" }) }));
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.match(body.path, new RegExp(`^production/${uploaderId}/${sourceId}/voice/`));
  assert.equal(body.fileName, "한국어 보이스.mp3");
  assert.equal(body.retentionHours, null);
  assert.deepEqual(h.signed, [body.path]);
});

test("production file signing checks current content access even for another uploader", async () => {
  const h = setup();
  const path = `production/${uploaderId}/${sourceId}/visuals/1790812800000-00000000-0000-4000-8000-000000000030.png`;
  h.actor.id = "00000000-0000-4000-8000-000000000099";
  const response = await h.api.GET(new Request(`https://os.example/api/v1/content/media?path=${encodeURIComponent(path)}`));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).url, `https://private.example/${path}`);
});

test("unsupported production formats stop before a signed upload is created", async () => {
  const h = setup();
  const response = await h.api.POST(new Request("https://os.example/api/v1/content/media", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceId, assetKind: "visuals", fileName: "unsafe.svg", fileSize: 1024, mimeType: "image/svg+xml" }) }));
  assert.equal(response.status, 400);
  assert.deepEqual(h.signed, []);
});
