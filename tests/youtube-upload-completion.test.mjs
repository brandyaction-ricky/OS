import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as zod from "zod";
import * as uploadResult from "../lib/server/youtube-upload-result.ts";

const kitId = "4c345370-6af6-425a-9b28-c769f7ee9a30";
const videoId = "video123456";
const channelId = "channel123";
const source = await readFile(new URL("../app/api/v1/youtube/upload/complete/route.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function setup(options = {}) {
  const rows = [{ id: kitId, record_type: "content_package", title: "발행 키트", parent_id: "source", metadata: { packageKind: "youtube_kit" }, version: 1, archived_at: null }];
  const controls = { conflict: false, insertFailures: 0, concurrentInsert: false, ...options };
  const actor = { id: "admin", role: "admin", team: "콘텐츠", supabase: {
    from(table) {
      assert.equal(table, "os_records");
      const conditions = [];
      let action = "read", fields, limit;
      const execute = () => {
        let matches = rows.filter((row) => conditions.every((condition) => condition(row)));
        if (action === "update") {
          if (controls.conflict || (controls.publicationConflict && matches.some((row) => row.record_type === "content_publish"))) return { data: [], error: null };
          matches.forEach((row) => Object.assign(row, structuredClone(fields), { version: row.version + 1 }));
        } else if (action === "insert") {
          if (controls.insertFailures-- > 0) return { data: null, error: { code: "NETWORK", message: "temporary insert error" } };
          if (controls.concurrentInsert && !rows.some((row) => row.id === fields.id)) rows.push({ ...structuredClone(fields), version: 1, archived_at: null, ...(controls.concurrentFields ?? {}) });
          if (rows.some((row) => row.id === fields.id)) return { data: null, error: { code: "23505", message: "duplicate key" } };
          rows.push({ ...structuredClone(fields), version: 1, archived_at: null });
          matches = [rows.at(-1)];
        }
        return { data: structuredClone(limit ? matches.slice(0, limit) : matches), error: null };
      };
      const builder = {
        select() { return builder; },
        eq(key, value) { conditions.push((row) => (key.startsWith("metadata->>") ? row.metadata?.[key.slice(11)] : row[key]) === value); return builder; },
        is(key, value) { conditions.push((row) => row[key] === value); return builder; },
        limit(value) { limit = value; return builder; },
        update(value) { action = "update"; fields = value; return builder; },
        insert(value) { action = "insert"; fields = value; return builder; },
        async maybeSingle() { const result = execute(); return { ...result, data: result.data?.[0] ?? null }; },
        then(resolve, reject) { return Promise.resolve().then(execute).then(resolve, reject); },
      };
      return builder;
    },
  } };
  const modules = {
    "next/server": { NextResponse: Response }, zod,
    "@/lib/server/youtube-upload-result": uploadResult,
    "@/lib/server/auth": { authenticateRequest: async (request) => {
      if (!request.headers.has("authorization")) throw new ApiError(401, "AUTH_REQUIRED", "로그인이 필요합니다.");
      return actor;
    } },
    "@/lib/server/youtube-oauth": { getYoutubeAccessToken: async () => "test", youtubeConnectionStatus: async () => ({ channelId, channelTitle: "우리 채널" }) },
    "@/lib/http": { ApiError, parseJson: (request) => request.json(), apiErrorResponse: (error) => Response.json({ code: error.code }, { status: error.status ?? 500 }) },
  };
  const commonJsModule = { exports: {} };
  let fetchCount = 0;
  runInNewContext(`(function(require, module, exports) { ${code}\n})`, {
    Response,
    fetch: async () => { fetchCount += 1; return Response.json({ items: [{ id: videoId, snippet: { title: "최종 영상", channelId: controls.wrongChannel ? "other" : channelId }, status: { privacyStatus: controls.privacyStatus ?? "private" } }] }); },
  })((key) => modules[key], commonJsModule, commonJsModule.exports);
  const complete = (authenticated = true) => commonJsModule.exports.POST(new Request("https://os.example/api/v1/youtube/upload/complete", { method: "POST", headers: { ...(authenticated ? { authorization: "Bearer test" } : {}), "content-type": "application/json" }, body: JSON.stringify({ kitId, videoId, privacyStatus: "private", finalApproval: true }) }));
  return { rows, actor, controls, complete, fetchCount: () => fetchCount };
}

test("completion rejects anonymous users, members and archived kits before contacting YouTube", async () => {
  const state = setup();
  assert.equal((await state.complete(false)).status, 401);
  state.actor.role = "member";
  assert.equal((await state.complete()).status, 403);
  state.actor.role = "admin"; state.rows[0].archived_at = "2026-09-08";
  assert.equal((await state.complete()).status, 404);
  assert.equal(state.fetchCount(), 0);
});

test("private and unlisted uploads stay ready; only verified public videos count as published", async () => {
  for (const privacyStatus of ["private", "unlisted", "public"]) {
    const state = setup({ privacyStatus });
    assert.equal((await state.complete()).status, 200);
    const publish = state.rows.find((row) => row.record_type === "content_publish");
    assert.equal(publish.status, privacyStatus === "public" ? "published" : "ready");
    assert.equal(publish.metadata.privacyStatus, privacyStatus);
  }
});

test("successful completion retries reuse the same record and original upload time", async () => {
  const state = setup();
  const first = await (await state.complete()).json();
  const originalTime = state.rows[0].metadata.youtubeUpload.uploadedAt;
  const retry = await (await state.complete()).json();
  assert.equal(first.recordId, retry.recordId);
  assert.equal(state.rows.length, 2);
  assert.equal(state.rows[0].metadata.youtubeUpload.uploadedAt, originalTime);
});

test("zero-row optimistic updates fail instead of reporting success or creating a publication", async () => {
  const state = setup({ conflict: true });
  assert.equal((await state.complete()).status, 409);
  assert.equal(state.rows.length, 1);
});

test("a retry repairs a failed publication insert without uploading the video again", async () => {
  const state = setup({ insertFailures: 1 });
  assert.equal((await state.complete()).status, 500);
  assert.equal(state.rows.length, 1);
  assert.equal((await state.complete()).status, 200);
  assert.equal(state.rows.length, 2);
});

test("a concurrent completion insert converges on one deterministic publication ID", async () => {
  const state = setup({ concurrentInsert: true });
  assert.equal((await state.complete()).status, 200);
  assert.equal(state.rows.length, 2);
  assert.equal(state.rows[1].id, uploadResult.youtubeUploadRecordId(channelId, videoId));
  assert.notEqual(state.rows[1].id, uploadResult.youtubeUploadRecordId(channelId, "another1234"));
});

test("unverified channel or privacy state never writes an upload record", async () => {
  for (const options of [{ wrongChannel: true }, { privacyStatus: "unknown" }]) {
    const state = setup(options);
    assert.ok((await state.complete()).status >= 400);
    assert.equal(state.rows.length, 1);
    assert.equal(state.rows[0].version, 1);
  }
});

test("legacy publication records are reused and verified privacy updates preserve manual fields", async () => {
  const state = setup();
  state.rows.push({ id: "legacy-id", record_type: "content_publish", title: "편집한 제목", description: "수동 메모", status: "published", version: 4, archived_at: null, metadata: { youtubeVideoId: videoId, channelId, manualNote: "보존", uploadedAt: "2026-08-01", privacyStatus: "public", publicationState: "published" } });
  const response = await (await state.complete()).json();
  assert.equal(response.recordId, "legacy-id");
  assert.equal(state.rows.length, 2);
  assert.equal(state.rows[1].status, "ready");
  assert.equal(state.rows[1].metadata.privacyStatus, "private");
  assert.equal(state.rows[1].metadata.publicationState, "uploaded");
  assert.equal(state.rows[1].metadata.manualNote, "보존");
  assert.equal(state.rows[1].metadata.uploadedAt, "2026-08-01");
  assert.equal(state.rows[1].title, "편집한 제목");
  assert.equal(state.rows[1].description, "수동 메모");
  assert.equal(state.rows[1].version, 5);
});

test("repeat verification follows both private-to-public and public-to-private visibility changes", async () => {
  const state = setup();
  await state.complete();
  const publication = state.rows[1];
  state.controls.privacyStatus = "public";
  assert.equal((await state.complete()).status, 200);
  assert.equal(publication.status, "published");
  assert.equal(publication.stage, "YouTube 공개");
  assert.equal(publication.metadata.publicationState, "published");
  assert.equal(publication.metadata.privacyStatus, state.rows[0].metadata.youtubeUpload.privacyStatus);
  state.controls.privacyStatus = "private";
  assert.equal((await state.complete()).status, 200);
  assert.equal(publication.status, "ready");
  assert.equal(publication.stage, "비공개 업로드");
  assert.equal(publication.metadata.publicationState, "uploaded");
  assert.equal(publication.metadata.privacyStatus, state.rows[0].metadata.youtubeUpload.privacyStatus);
  assert.equal(state.rows.length, 2);
});

test("conflicting publication visibility updates return 409 without overwriting newer fields", async () => {
  const state = setup();
  await state.complete();
  const before = structuredClone(state.rows[1]);
  state.controls.privacyStatus = "public";
  state.controls.publicationConflict = true;
  assert.equal((await state.complete()).status, 409);
  assert.deepEqual(state.rows[1], before);
});

test("archived publication records are never restored or duplicated by verification", async () => {
  const state = setup();
  await state.complete();
  state.rows[1].archived_at = "2026-09-08T10:00:00Z";
  const before = structuredClone(state.rows[1]);
  state.controls.privacyStatus = "public";
  assert.equal((await state.complete()).status, 409);
  assert.deepEqual(state.rows[1], before);
  assert.equal(state.rows.length, 2);
});

test("concurrent insert reuse also synchronizes verified state and respects archived records", async () => {
  const state = setup({ privacyStatus: "public", concurrentInsert: true, concurrentFields: { status: "ready", stage: "비공개 업로드", metadata: { youtubeVideoId: videoId, channelId, privacyStatus: "private", publicationState: "uploaded", manualNote: "보존" } } });
  assert.equal((await state.complete()).status, 200);
  assert.equal(state.rows[1].status, "published");
  assert.equal(state.rows[1].metadata.privacyStatus, "public");
  assert.equal(state.rows[1].metadata.manualNote, "보존");
  const archived = setup({ concurrentInsert: true, concurrentFields: { archived_at: "2026-09-08T10:00:00Z" } });
  assert.equal((await archived.complete()).status, 409);
  assert.equal(archived.rows[1].archived_at, "2026-09-08T10:00:00Z");
});
