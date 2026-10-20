import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as zod from "zod";
import * as pipeline from "../lib/content-pipeline.ts";
import * as contentInput from "../lib/content-input.ts";

class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const sourceId = "00000000-0000-4000-8000-000000000010";
const ownerId = "00000000-0000-4000-8000-000000000020";
const runId = "00000000-0000-4000-8000-000000000030";
const prefix = `${ownerId}/${sourceId}/${runId}/`;
const inputKey = "a".repeat(64);
const srt = "1\n00:00:00,000 --> 00:00:03,000\n시작\n\n2\n00:00:04,000 --> 00:00:06,000\n마무리";
const final = { video: `${prefix}final_myin-1234abcd.mp4`, srt: `${prefix}subs_youtube-1234abcd.srt`, at: "2026-10-20T00:00:00.000Z", durationSeconds: 10 };
const serverSource = await readFile(new URL("../lib/server/shortform-longform.ts", import.meta.url), "utf8");
const routeSource = await readFile(new URL("../app/api/v1/content/shorts/longform/route.ts", import.meta.url), "utf8");
function compile(source, modules) {
  const compiled = { exports: {} };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: compiled, exports: compiled.exports, URL, require: (name) => { assert.ok(name in modules, name); return modules[name]; } });
  return compiled.exports;
}
function setup() {
  const h = { storageReads: [], signed: [], factories: 0, caption: new Blob([srt]), accessError: null, signError: null,
    plan: { inputKey }, state: { records: [{ id: runId, owner_id: ownerId, record_type: "ai_job", stage: "final_ready", status: "done",
      archived_at: null, created_at: "2026-10-20T00:00:00Z", metadata: { kind: "youtube_myin_v13", inputKey, final: { ...final } } }] } };
  h.actor = { supabase: { callerScoped: true } };
  h.factory = () => {
    h.factories++;
    return { storage: { from: (bucket) => ({
      download: async (path) => { h.storageReads.push([bucket, path]); return { data: h.caption }; },
      createSignedUrl: async (path, ttl) => { h.signed.push([bucket, path, ttl]); return { data: h.signError ? null : { signedUrl: "https://private.example/video.mp4?signed=temporary" }, error: h.signError }; },
    }) } };
  };
  h.api = compile(serverSource, { "node:crypto": crypto, zod, "@/lib/http": { ApiError }, "@/lib/content-pipeline": pipeline, "@/lib/content-input": contentInput,
    "@/lib/supabase/server": { createServiceSupabase: h.factory }, "./youtube-automation-input": { readYoutubeAutomationInput: async (client, id) => {
      assert.equal(client, h.actor.supabase); assert.equal(id, sourceId);
      if (h.accessError) throw h.accessError;
      return { state: h.state, plan: h.plan };
    } } });
  h.read = (key) => h.api.readShortformLongform(h.actor, sourceId, key);
  return h;
}
const errorCode = (code) => (error) => error.code === code;

test("resolves private video and real subtitles without copying, changing or expiring the longform files", async () => {
  const h = setup(); const before = JSON.stringify(h.state);
  const result = await h.read();
  assert.equal(result.transcript, srt);
  assert.equal(result.reference.runId, runId);
  assert.match(result.reference.key, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(result.reference).sort(), ["key", "kind", "runId"]);
  assert.deepEqual(h.storageReads, [["os-content-media", final.srt]]);
  assert.deepEqual(h.signed, [["os-youtube-video", final.video, 3600]]);
  assert.equal(JSON.stringify(h.state), before);
  assert.equal((await h.read(result.reference.key)).reference.key, result.reference.key);
});

test("source permission is checked before creating privileged storage access", async () => {
  const h = setup(); h.accessError = new ApiError(404, "CONTENT_SOURCE_NOT_FOUND", "denied");
  await assert.rejects(h.read(), errorCode("CONTENT_SOURCE_NOT_FOUND"));
  assert.equal(h.factories, 0);
});

test("existing v13 finals with exact unsuffixed basenames remain readable in their own run folder", async () => {
  const h = setup();
  h.state.records[0].metadata.final = { ...final, video: `${prefix}final_myin.mp4`, srt: `${prefix}subs_youtube.srt` };
  const result = await h.read();
  assert.equal(result.transcript, srt);
  assert.deepEqual(h.signed, [["os-youtube-video", `${prefix}final_myin.mp4`, 3600]]);
  for (const name of ["../final_myin.mp4", "final_myin-other.mp4", "final_myin.mp4/extra"]) {
    h.state.records[0].metadata.final.video = prefix + name;
    await assert.rejects(h.read(), errorCode("SHORTFORM_LONGFORM_INVALID"));
  }
});

test("revoked approval, a changed script or a newer unfinished run cannot reuse an old final", async () => {
  for (const change of [
    (h) => { h.plan.inputKey = null; },
    (h) => { h.plan.inputKey = "b".repeat(64); },
    (h) => { h.state.records.push({ ...h.state.records[0], id: "new", created_at: "2026-10-20T01:00:00Z", stage: "final_pending" }); },
  ]) {
    const h = setup(); change(h);
    await assert.rejects(h.read(), errorCode("SHORTFORM_LONGFORM_NOT_READY"));
    assert.equal(h.factories, 0);
  }
});

test("cross-content paths and traversal in final metadata never reach storage", async () => {
  for (const [field, path] of [["video", `${prefix}../final_myin-1234abcd.mp4`], ["video", "other/final.mp4"],
    ["srt", `${prefix}../subs_youtube-1234abcd.srt`], ["srt", "other/subs.srt"]]) {
    const h = setup(); h.state.records[0].metadata.final[field] = path;
    await assert.rejects(h.read(), errorCode("SHORTFORM_LONGFORM_INVALID"));
    assert.equal(h.factories, 0);
  }
});

test("a replaced final invalidates a persisted reference before reading or signing any files", async () => {
  const h = setup(); const first = await h.read();
  h.state.records[0].metadata.final = { ...final, at: "2026-10-20T01:00:00.000Z", video: `${prefix}final_myin-abcd1234.mp4` };
  h.factories = 0;
  await assert.rejects(h.read(first.reference.key), errorCode("SHORTFORM_LONGFORM_CHANGED"));
  assert.equal(h.factories, 0);
});

test("missing, oversized, empty and out-of-range subtitles cannot be imported", async () => {
  for (const [caption, code] of [[null, "SHORTFORM_LONGFORM_CAPTIONS_MISSING"], [new Blob(["x".repeat(2_000_001)]), "SHORTFORM_LONGFORM_CAPTIONS_MISSING"],
    [new Blob(["not timed"]), "SHORTFORM_LONGFORM_CAPTIONS_INVALID"], [new Blob([srt.replace("00:00:06,000", "00:01:06,000")]), "SHORTFORM_LONGFORM_CAPTIONS_INVALID"]]) {
    const h = setup(); h.caption = caption;
    await assert.rejects(h.read(), errorCode(code));
    assert.equal(h.signed.length, 0);
  }
});

test("video signing failures are reported without a usable preview", async () => {
  const h = setup(); h.signError = new Error("missing file");
  await assert.rejects(h.read(), errorCode("SHORTFORM_LONGFORM_VIDEO_MISSING"));
});

test("route authenticates, validates query identifiers and marks signed URLs as no-store", async () => {
  let denied = false; let reads = 0;
  const api = compile(routeSource, { zod, "next/server": { NextResponse: { json: (value, init) => Response.json(value, init) } },
    "@/lib/http": { ApiError, apiErrorResponse: (e) => Response.json({ error: { code: e.code } }, { status: e.status ?? 500 }) },
    "@/lib/server/auth": { authenticateRequest: async () => { if (denied) throw new ApiError(401, "UNAUTHORIZED", "login"); return "actor"; } },
    "@/lib/server/shortform-longform": { readShortformLongform: async (actor, id, key) => { reads++; assert.equal(actor, "actor"); assert.equal(id, sourceId); assert.equal(key, inputKey); return { reference: {} }; } } });
  for (const query of ["sourceId=bad", `sourceId=${sourceId}&expectedKey=bad`, "path=arbitrary"]) {
    assert.equal((await api.GET(new Request(`https://os.example/longform?${query}`))).status, 400);
  }
  assert.equal(reads, 0);
  const response = await api.GET(new Request(`https://os.example/longform?sourceId=${sourceId}&expectedKey=${inputKey}`));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  denied = true;
  assert.equal((await api.GET(new Request(`https://os.example/longform?sourceId=${sourceId}`))).status, 401);
  assert.equal(reads, 1);
});
