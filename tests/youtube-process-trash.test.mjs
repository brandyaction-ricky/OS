import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as zod from "zod";
import * as project from "../lib/youtube-process/project.ts";

// 내 영상 휴지통 (staff request 2026-10-26, owner: 「관리자가 직접 영구 삭제」): maker · PD · admin trash and restore,
// only an admin purges and only after 30 days, and a purge removes exactly the video's own files.
class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const day = 86_400_000;
const meta = (stage = "make") => { const value = project.newProjectMeta({ type: "anim", target: "타겟", note: "", refs: [] }, "2026-10-01T00:00:00Z"); value.yp.stage = stage; return value; };

/** An in-memory os_records table and storage with just the calls the trash module makes. */
function fakeService(rows, files) {
  const removed = [];
  const query = (filters = [], action = null) => {
    const match = row => filters.every(([kind, key, value]) => {
      const field = key.startsWith("metadata->>") ? row.metadata?.[key.slice(11)] : row[key];
      return kind === "eq" ? field === value : kind === "is" ? (value === null ? field == null : field === value) : kind === "not-null" ? field != null : true;
    });
    const api = {
      select: () => api, order: () => api, limit: () => api,
      eq: (key, value) => query([...filters, ["eq", key, value]], action),
      is: (key, value) => query([...filters, ["is", key, value]], action),
      not: (key) => query([...filters, ["not-null", key]], action),
      update: patch => query(filters, { patch }),
      maybeSingle: async () => { const found = rows.filter(match); if (action) found.forEach(row => { Object.assign(row, action.patch); row.version += 1; }); return { data: found[0] ? structuredClone(found[0]) : null, error: null }; },
      then: (resolve) => { const found = rows.filter(match); if (action) found.forEach(row => Object.assign(row, action.patch)); resolve({ data: structuredClone(found), error: null }); },
    };
    return api;
  };
  return {
    removed,
    from: () => query(),
    storage: { from: bucket => ({
      list: async prefix => {
        const inside = files.filter(file => file.bucket === bucket && file.path.startsWith(`${prefix}/`)).map(file => file.path.slice(prefix.length + 1));
        const names = [...new Set(inside.map(rest => rest.split("/")[0]))];
        return { data: names.map(name => ({ name, id: inside.includes(name) ? `id-${name}` : null })), error: null };
      },
      remove: async paths => { removed.push(...paths.map(path => `${bucket}:${path}`)); return { error: null }; },
    }) },
  };
}

async function load(service) {
  const source = await readFile(new URL("../lib/server/youtube-process-trash.ts", import.meta.url), "utf8");
  const compiled = { exports: {} };
  const modules = { zod, "@/lib/http": { ApiError }, "@/lib/supabase/server": { createServiceSupabase: () => service }, "@/lib/youtube-process/project": project,
    "./youtube-process": { conflict: () => new ApiError(409, "RECORD_VERSION_CONFLICT", "충돌") }, "./youtube-ai-jobs": { STAFF_AI_JOB_KIND: "youtube_staff_ai_v1" } };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: compiled, exports: compiled.exports, require: name => modules[name] });
  return compiled.exports;
}

const actor = (id, role = "member") => ({ id, ownerId: id, name: id === "maker" ? "로건" : id, role });
const video = () => ({ id: "00000000-0000-4000-8000-000000000001", version: 3, title: "퇴사 전 순서", assignee_id: "pd", owner_id: "maker", updated_at: "", archived_at: null, record_type: "content_topic", metadata: { workflow: "youtube_v1", ...meta() } });

test("30 days in the trash, then an admin may purge; maker, PD and admin may trash", () => {
  const now = Date.parse("2026-11-01T00:00:00Z");
  assert.equal(project.trashDaysLeft("2026-11-01T00:00:00Z", now), 30);
  assert.equal(project.trashDaysLeft(new Date(now - 29 * day).toISOString(), now), 1);
  assert.equal(project.trashDaysLeft(new Date(now - 30 * day).toISOString(), now), 0);
  const row = { ownerId: "maker", assigneeId: "pd" };
  assert.equal(project.mayTrash(row, "maker", false), true);
  assert.equal(project.mayTrash(row, "pd", false), true);
  assert.equal(project.mayTrash(row, "someone", false), false);
  assert.equal(project.mayTrash(row, "someone", true), true);
});

test("trash keeps the row (archived) with who · when · why, closes waiting AI jobs, and restore brings it back as it was", async () => {
  const rows = [video(), { id: "job1", version: 1, record_type: "ai_job", parent_id: video().id, status: "backlog", owner_id: "maker", metadata: { kind: "youtube_staff_ai_v1" } },
    { id: "run1", version: 1, record_type: "ai_job", parent_id: video().id, status: "active", owner_id: "maker", metadata: { kind: "youtube_myin_v13" } }];
  const trash = await load(fakeService(rows, []));
  await assert.rejects(trash.actOnYoutubeTrash(actor("someone"), video().id, { action: "trash", expectedVersion: 3, reason: "" }), error => error.status === 403);
  await assert.rejects(trash.actOnYoutubeTrash(actor("maker"), video().id, { action: "trash", expectedVersion: 2, reason: "" }), error => error.status === 409);
  await trash.actOnYoutubeTrash(actor("pd"), video().id, { action: "trash", expectedVersion: 3, reason: "주제가 겹쳐서" });
  assert.ok(rows[0].archived_at);
  assert.equal(rows[0].metadata.trash.reason, "주제가 겹쳐서");
  assert.equal(rows[0].metadata.trash.stage, "make");
  assert.equal(rows[0].metadata.yp.stage, "make");
  assert.equal(rows[1].status, "cancelled");
  assert.equal(rows[2].status, "active");
  const listed = await trash.listYoutubeTrash(actor("someone"));
  assert.equal(listed.length, 1);
  assert.equal(listed[0].canManage, false);
  await assert.rejects(trash.actOnYoutubeTrash(actor("someone"), video().id, { action: "restore" }), error => error.status === 403);
  await trash.actOnYoutubeTrash(actor("maker"), video().id, { action: "restore" });
  assert.equal(rows[0].archived_at, null);
  assert.equal(rows[0].metadata.trash, undefined);
  assert.equal(rows[0].metadata.yp.stage, "make");
});

test("only an admin purges, only after 30 days, and only the video's own folders go", async () => {
  const id = video().id;
  const trashedAt = (days) => ({ ...video(), archived_at: new Date(Date.now() - days * day).toISOString(), metadata: { ...video().metadata, trash: { at: new Date(Date.now() - days * day).toISOString(), by: "maker", name: "로건", reason: "", stage: "make" } } });
  const files = [
    { bucket: "os-content-media", path: `youtube/${id}/thumb/a.png` }, { bucket: "os-content-media", path: `youtube/${id}/final/b.mp4` },
    { bucket: "os-content-media", path: `maker/${id}/run1/handout.png` }, { bucket: "os-youtube-video", path: `maker/${id}/run1/final_myin-x.mp4` },
    { bucket: "os-youtube-voice", path: `maker/${id}/run1/p00.wav` },
    // Another video's files and the shared asset library stay.
    { bucket: "os-content-media", path: "youtube/other-video/thumb/c.png" }, { bucket: "os-youtube-video", path: `maker/other-video/run9/final.mp4` },
    { bucket: "os-content-media", path: "automation/maker/asset/photo.png" },
  ];
  const early = [trashedAt(29), { id: "run1", version: 1, record_type: "ai_job", parent_id: id, owner_id: "maker", metadata: {} }];
  const trashEarly = await load(fakeService(early, files));
  await assert.rejects(trashEarly.actOnYoutubeTrash(actor("boss", "admin"), id, { action: "purge", reason: "정리", confirm: true }), error => error.code === "PURGE_TOO_EARLY" && /1일 남았어요/.test(error.message));

  const rows = [trashedAt(31), { id: "run1", version: 1, record_type: "ai_job", parent_id: id, owner_id: "maker", metadata: {} }];
  const service = fakeService(rows, files);
  const trash = await load(service);
  await assert.rejects(trash.actOnYoutubeTrash(actor("maker"), id, { action: "purge", reason: "정리", confirm: true }), error => error.code === "PURGE_DENIED");
  const result = await trash.actOnYoutubeTrash(actor("boss", "admin"), id, { action: "purge", reason: "정리", confirm: true });
  assert.equal(result.files, 5);
  assert.deepEqual([...service.removed].sort(), [`os-content-media:maker/${id}/run1/handout.png`, `os-content-media:youtube/${id}/final/b.mp4`, `os-content-media:youtube/${id}/thumb/a.png`,
    `os-youtube-video:maker/${id}/run1/final_myin-x.mp4`, `os-youtube-voice:maker/${id}/run1/p00.wav`]);
  assert.equal(rows[0].metadata.trash.purged.reason, "정리");
  assert.ok(rows[0].archived_at);
  // Purged videos leave the 휴지통 and cannot be restored.
  assert.deepEqual(JSON.parse(JSON.stringify(await trash.listYoutubeTrash(actor("boss", "admin")))), []);
  await assert.rejects(trash.actOnYoutubeTrash(actor("boss", "admin"), id, { action: "restore" }), error => error.code === "NOT_IN_TRASH");
});
