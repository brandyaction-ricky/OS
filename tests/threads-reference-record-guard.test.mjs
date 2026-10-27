import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as zod from "zod";

class ApiError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, code }); }
}
async function load(file, modules) {
  const source = await readFile(new URL("../" + file, import.meta.url), "utf8");
  const compiled = { exports: {} };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: compiled, exports: compiled.exports, URL, Date, require: name => { assert.ok(name in modules, name); return modules[name]; } });
  return compiled.exports;
}
const schedule = await load("lib/content-automation-schedule.ts", {});
const contract = await load("lib/threads-reference.ts", { zod, "./http": { ApiError }, "./content-automation-schedule": schedule });
const guard = await load("lib/threads-reference-record-guard.ts", { "./threads-reference": contract });
const owner = "11111111-1111-4111-8111-111111111111";
const organization = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";
const weakEvidence = [{ metrics: { likes: { value: 6, verified: true } } }];
const referenceMetadata = { space: "personal", kind: contract.THREADS_REFERENCE_KIND,
  editorial_workflow: contract.THREADS_REFERENCE_WORKFLOW, reference_items: weakEvidence };

async function harness(path, metadata = referenceMetadata) {
  const writes = [];
  const current = { id, record_type: "content_topic", title: "Collected source", owner_id: owner,
    status: "draft", stage: "candidate", version: 1, metadata };
  const db = { from(table) {
    let payload = null;
    const result = () => ({ data: payload ? { ...current, ...payload } : current, error: null, count: 0 });
    const builder = new Proxy({}, { get(_target, key) {
      if (key === "then") return resolve => resolve(result());
      if (key === "maybeSingle" || key === "single") return async () => result();
      return (...args) => {
        if (key === "insert" || key === "update") { payload = args[0]; writes.push({ table, kind: key, payload }); }
        return builder;
      };
    } });
    return builder;
  } };
  const types = { RECORD_TYPES: ["content_topic", "content_publish", "ai_job", "task", "skill"] };
  const validation = await load("lib/record-validation.ts", { zod, "./record-types": types });
  const noOp = async () => {};
  const api = await load(path, {
    "next/server": { NextResponse: Response }, zod,
    "@/lib/http": { ApiError, parseJson: request => request.json(), apiErrorResponse: error => Response.json({ error: { code: error.code } }, { status: error.status ?? 500 }) },
    "@/lib/server/auth": { authenticateRequest: async () => ({ id: owner, ownerId: owner, type: path.includes("agent-records") ? "agent" : "user", supabase: db }), requireAgentScope: () => {} },
    "@/lib/supabase/server": { createServiceSupabase: () => db }, "@/lib/server/organization": { assertOrganization: noOp },
    "@/lib/record-types": types, "@/lib/record-validation": validation,
    "@/lib/threads-reference": contract, "@/lib/threads-reference-record-guard": guard,
    "@/lib/content-comments": { isCommentDraftPatch: () => false }, "@/lib/server/meeting-review": { assertReviewedMeetingTask: noOp },
    "@/lib/html-entities": { decodeHtmlEntities: value => value }, "@/lib/content-origin": { contentOrigin: () => "own" },
    "@/lib/server/skill-source": { assertSkillSource: noOp }, "@/lib/content-pipeline": { protectedPipelineChange: () => false },
    "@/lib/youtube-process/project": { protectedYoutubeChange: () => false },
    "@/lib/appeal-decision-guard": { changesAppealDecision: () => false, isAppealCandidatePackage: () => false },
    "@/lib/development-requests": { isDevelopmentRequest: () => false }, "@/lib/development-links": { assertDevelopmentRequestLink: noOp },
    "@/lib/server/hr-legacy-menus": { assertLegacyLeaveWritable: noOp }, "@/lib/team/dates": {},
  });
  const send = (method, body) => api[method](new Request("https://os.test", {
    method, body: JSON.stringify({ organizationId: organization, ...body }),
  }));
  const archive = () => api.DELETE(new Request(`https://os.test?id=${id}&recordId=${id}&organizationId=${organization}&confirm=true`, { method: "DELETE" }));
  return { send, archive, writes };
}

for (const path of ["app/api/v1/records/route.ts", "app/api/v1/agent-records/route.ts"]) {
  test(`${path}: stripping reference markers cannot turn six likes into a confirmed direct topic`, async () => {
    const api = await harness(path);
    for (const changes of [
      { stage: "confirmed", metadata: { space: "personal", reference_items: weakEvidence } },
      { stage: "confirmed", metadata: { space: "personal" } },
      { metadata: { space: "personal", kind: null, editorial_workflow: null } },
      { stage: "confirmed" }, { title: "Bypassed reference edit" },
    ]) {
      const response = await api.send("PATCH", { id, expectedVersion: 1, ...changes });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error.code, "THREADS_REFERENCE_API_REQUIRED");
    }
    assert.equal(api.writes.length, 0);
  });
  test(`${path}: derived and partially marked reference topics cannot drop their workflow`, async () => {
    for (const metadata of [
      { space: "personal", editorial_workflow: contract.THREADS_REFERENCE_WORKFLOW, reference_items: weakEvidence },
      { space: "personal", kind: contract.THREADS_REFERENCE_KIND },
      { space: "personal", reference_items: weakEvidence },
    ]) {
      const api = await harness(path, metadata);
      assert.equal((await api.send("PATCH", { id, expectedVersion: 1, metadata: { space: "personal" } })).status, 403);
      assert.equal((await api.archive()).status, 403);
      assert.equal(api.writes.length, 0);
    }
  });
  test(`${path}: creating or injecting reference evidence uses the dedicated topic API`, async () => {
    const api = await harness(path, { space: "personal", source: "direct" });
    for (const marker of [
      { kind: contract.THREADS_REFERENCE_KIND }, { editorial_workflow: contract.THREADS_REFERENCE_WORKFLOW },
      { reference_items: weakEvidence },
    ]) {
      const metadata = { space: "personal", ...marker };
      assert.equal((await api.send("POST", { recordType: "content_topic", title: "Injected source", metadata })).status, 403);
      assert.equal((await api.send("PATCH", { id, expectedVersion: 1, metadata })).status, 403);
    }
    assert.equal(api.writes.length, 0);
  });
  test(`${path}: ordinary direct topics retain creation, editing and archive`, async () => {
    const api = await harness(path, { space: "personal", source: "direct" });
    assert.equal((await api.send("POST", { recordType: "content_topic", title: "Direct insight", metadata: { space: "personal", source: "direct" } })).status, 201);
    assert.equal((await api.send("PATCH", { id, expectedVersion: 1, title: "Edited direct insight" })).status, 200);
    assert.equal((await api.archive()).status, 200);
    assert.equal(api.writes.filter(write => write.table === "os_records").length, 3);
  });
}
