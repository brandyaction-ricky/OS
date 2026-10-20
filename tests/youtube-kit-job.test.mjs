import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as zod from "zod";
import * as pipeline from "../lib/content-pipeline.ts";
import * as contentInput from "../lib/content-input.ts";
import * as contentSafety from "../lib/content-safety.ts";

// ⑦ 발행키트 by the staff AI: the OS checks the shape, keeps only chapters at real subtitle times and stores the kit record.
class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const source = await readFile(new URL("../lib/server/youtube-kit-job.ts", import.meta.url), "utf8");
const compiled = { exports: {} };
const modules = { "node:crypto": crypto, zod, "@/lib/http": { ApiError }, "@/lib/content-pipeline": pipeline, "@/lib/content-input": contentInput, "@/lib/content-safety": contentSafety,
  "./content-generation": { procedureRefs: async () => [{ id: "doc", title: "유튜브 발행키트 절차" }] },
  // 유튜브 공정 v1 projects take their own path (tests/youtube-process-ai.test.mjs); these sources are pipeline topics.
  "./youtube-process-ai": { isYoutubeV1: (row) => row.metadata?.workflow === "youtube_v1" } };
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module: compiled, exports: compiled.exports, require: (name) => modules[name] });
const job = compiled.exports;
const plain = (value) => JSON.parse(JSON.stringify(value)); // objects made inside the vm context

const srt = ["1\n00:00:00,000 --> 00:00:05,000\n시작", "2\n00:01:10,000 --> 00:01:15,000\n둘째", "3\n00:03:00,000 --> 00:03:04,000\n셋째"].join("\n\n");
const record = (id, extra) => ({ id, version: 1, archived_at: null, created_at: "2026-10-19T00:00:00Z", metadata: {}, ...extra });
const state = { source: record("source", { title: "P01", brand: "", team: "", metadata: { pipelineEnabled: true, transcriptSrt: srt } }), approved: [true, true, false], signatures: ["a", "b", "c"],
  production: { myinFinal: false }, records: [record("script", { record_type: "content_script", description: "원고" })] };
let inserted = null;
const supabase = { storage: { from: () => ({ download: async () => ({ data: null }) }) },
  from: () => ({ insert(row) { inserted = row; return { select: () => ({ single: async () => ({ data: { id: "kit" }, error: null }) }) }; } }) };
const kit = { title: "제목", description: "설명", tags: ["강점", "#강점"], chapters: ["00:00 시작", "01:10 둘째", "03:00 셋째"], pinnedComment: "", kakao: "", cafe: "", post: "", checklist: ["썸네일 올리기"] };

test("a staff kit is stored with real-time chapters; a wrong shape comes back as issues", async () => {
  await assert.rejects(job.saveStaffKit(supabase, "owner", state, { ...kit, title: "" }, { model: "m", jobId: "j" }), (error) => error.status === 422);
  const saved = await job.saveStaffKit(supabase, "owner", state, kit, { model: "m", jobId: "j" });
  assert.deepEqual(plain(saved), { kitId: "kit", chapters: 3, chapterTimingVerified: true });
  assert.equal(inserted.metadata.packageKind, "youtube_kit");
  assert.equal(inserted.metadata.rulesVersion, 4);
  assert.deepEqual(plain(inserted.metadata.result.tags), ["강점"]);
  await job.saveStaffKit(supabase, "owner", state, { ...kit, chapters: ["00:00 시작", "01:30 없는 시각", "03:00 셋째"] }, { model: "m", jobId: "j" });
  assert.deepEqual(plain(inserted.metadata.result.chapters), []);
  assert.ok(inserted.metadata.result.checklist[0].includes("챕터"));
});

test("kit jobs need gates 1 and 2, and their key moves with gate 2", () => {
  assert.throws(() => job.assertKitInputs({ ...state, approved: [true, false, false] }), (error) => error.code === "PIPELINE_APPROVAL_REQUIRED");
  assert.notEqual(job.kitInputKey(state), job.kitInputKey({ ...state, signatures: ["a", "b2", "c"] }));
});
