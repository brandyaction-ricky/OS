import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import * as zod from "zod";

class ApiError extends Error {
  constructor(status, code, message, details) { super(message); Object.assign(this, { status, code, details }); }
}
async function load(file, modules, globals = {}) {
  const source = await readFile(new URL("../" + file, import.meta.url), "utf8");
  const compiled = { exports: {} };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: compiled, exports: compiled.exports, URL, Date, crypto: crypto.webcrypto, ...globals, require: name => { assert.ok(name in modules, name); return modules[name]; } });
  return compiled.exports;
}
const schedule = await load("lib/content-automation-schedule.ts", {});
const contractModules = { zod, "./http": { ApiError }, "./content-automation-schedule": schedule };
const contract = await load("lib/threads-reference.ts", contractModules);
const referenceRecordGuard = await load("lib/threads-reference-record-guard.ts", { "./threads-reference": contract });
const contractAt = now => load("lib/threads-reference.ts", contractModules, { Date: class extends Date { static now() { return Date.parse(now); } } });
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const refId = "33333333-3333-4333-8333-333333333333", topicId = "44444444-4444-4444-8444-444444444444";
const secondRefId = "55555555-5555-4555-8555-555555555555";
const actor = { type: "user", ownerId: owner };
const reference = (changes = {}) => ({ ...contract.newThreadsReference(), id: "reference-a", url: "https://example.substack.com/p/example",
  title: "A source", author: "Source author", publishedAt: "2026-10-20", observedAt: "2026-10-26T08:00:00.000Z", readScope: "full",
  metrics: { ...contract.newThreadsReference().metrics, views: { value: 100000, verified: true } },
  koreanTitle: "일과 역할을 구분하는 법", summary: "원문은 업무량과 맡은 역할을 구분하는 상황을 설명한다.", suggestedTopic: "일을 줄이기 전에 역할부터 살펴보기",
  relevanceNote: "업무 피로를 느끼는 직장인의 실제 장면에 연결된다.", audienceNote: "댓글에서 독자들이 업무량을 줄여도 같은 피로가 남는 이유를 물었다.", readNote: "원문 첫 문장부터 마지막 결론까지 직접 확인했다.",
  scene: "The visible passage describes a work situation.", readerQuestion: "Which part of the work needs changing?",
  addedPerspective: "Separate workload from the kind of task.", ...changes });
const record = (id, metadata = {}) => ({ id, record_type: "content_topic", title: "Candidate", description: "", version: 1, owner_id: owner,
  brand: "Example", status: "draft", stage: "candidate", metadata: { space: "personal", ...metadata }, archived_at: null });
const source = () => record(refId, { kind: contract.THREADS_REFERENCE_KIND, editorial_workflow: contract.THREADS_REFERENCE_WORKFLOW, reference_items: [reference()] });
const topic = () => ({ ...record(topicId, { editorial_workflow: contract.THREADS_REFERENCE_WORKFLOW,
  sourceRef: "https://example.substack.com/p/example", reference_items: [reference()],
  brief: { one: "A chosen question", who: "Readers", message: "A distinction", sources: "Evidence", warn: "Read partially" } }), stage: "confirmed" });
const item = () => ({ ...record("66666666-6666-4666-8666-666666666666", { channel: "threads", posts: ["An existing paragraph"] }),
  record_type: "content_publish", parent_id: topicId, stage: "making" });
const code = expected => error => error.code === expected;
function memoryDb(tables, errors = {}) {
  const queries = [];
  return { queries, from(table) {
    const filters = [];
    const query = { table, filters }; queries.push(query);
    const builder = {
      select(fields) { query.fields = fields; return this; }, eq(key, value) { filters.push([key, value]); return this; },
      is(key, value) { filters.push([key, value]); return this; },
      async limit(max) {
        const rows = (tables[table] ?? []).filter(row => filters.every(([key, wanted]) => row[key] === wanted));
        return { data: rows.slice(0, max), error: null };
      },
      async maybeSingle() {
        if (errors[table]) return { data: null, error: errors[table] };
        const value = key => row => key.startsWith("metadata->>") ? row.metadata[key.slice(11)] : row[key];
        const rows = tables[table] ?? [];
        return { data: rows.find(row => filters.every(([key, wanted]) => value(key)(row) === wanted)) ?? null, error: null };
      },
    };
    return builder;
  } };
}
async function serverHarness({ docs, topics = [topic()], readable = true, topicReadError } = {}) {
  const store = memoryDb({ os_documents: docs ?? [{ id: "77777777-7777-4777-8777-777777777777", title: "쓰레드 자동화 운영 정본 — 안저 · Aside × OS",
    status: "canonical", reader_scope: "all", current_version: 10, content_md: "Approved procedure and examples" }], os_records: topics }, { os_records: topicReadError });
  let accessChecks = 0;
  const server = await load("lib/server/threads-reference.ts", {
    "node:crypto": crypto, "@/lib/http": { ApiError }, "@/lib/threads-reference": contract,
    "@/lib/supabase/server": { createServiceSupabase: () => store },
    "./knowledge-page-access": { POLICY_FIELDS: "id,status,reader_scope", readableKnowledgePages: async (_actor, rows) => {
      accessChecks++; return new Set(readable ? rows.map(row => row.id) : []);
    } },
  });
  return { server, store, accessChecks: () => accessChecks };
}

test("observations preserve unknown counts and distinguish an observed zero from an unverified number", () => {
  const ref = reference();
  ref.metrics.views = { value: null, verified: false };
  assert.equal(contract.parseThreadsReferences([ref])[0].metrics.views.value, null);
  assert.equal(contract.hasVerifiedThreadsReaction(ref), false);
  ref.metrics.likes = { value: 0, verified: true };
  assert.equal(contract.hasVerifiedThreadsReaction(ref), true);
  ref.metrics.likes = { value: 200, verified: false };
  assert.equal(contract.hasVerifiedThreadsReaction(ref), false);
  ref.metrics.likes = { value: null, verified: true };
  assert.throws(() => contract.parseThreadsReferences([ref]), code("THREADS_REFERENCES_INVALID"));
});
test("source URLs, observation times, counts and field names are bounded without fetching an external page", () => {
  for (const patch of [{ url: "javascript:alert(1)" }, { url: "https://user:secret@example.com" }, { url: "http://example.com" },
    { observedAt: "yesterday" }, { publishedAt: "2026-02-31" }, { readScope: "read" }, { approved: true }])
    assert.throws(() => contract.parseThreadsReferences([reference(patch)]), code("THREADS_REFERENCES_INVALID"));
  for (const value of [-1, 0.5, Infinity]) {
    const ref = reference(); ref.metrics.views.value = value;
    assert.throws(() => contract.parseThreadsReferences([ref]), code("THREADS_REFERENCES_INVALID"));
  }
  assert.throws(() => contract.parseThreadsReferences([reference(), reference()]), code("THREADS_REFERENCES_INVALID"));
});
test("partial/unread/preview references can be collected but cannot enter drafting", () => {
  for (const readScope of ["partial", "preview", "unavailable"]) {
    const refs = contract.parseThreadsReferences([reference({ readScope })]);
    assert.throws(() => contract.assertThreadsReferencesReady(refs), code("THREADS_REFERENCE_QUALITY_REQUIRED"));
  }
  contract.assertThreadsReferencesReady([reference()]);
  for (const field of ["scene", "readerQuestion", "addedPerspective"])
    assert.throws(() => contract.assertThreadsReferencesReady([reference({ [field]: "" })]), code("THREADS_REFERENCE_QUALITY_REQUIRED"));
});
const comparison = (likes = 50) => ({ basis: "동일 저자의 유사한 에세이 형식이며 모두 발행 후 7일이 지난 글을 비교했다.",
  posts: Array.from({ length: 5 }, (_, index) => ({ url: `https://example.substack.com/p/comparison-${index}`,
    likes, publishedAt: `2026-10-${String(index + 1).padStart(2, "0")}` })) });
const substack = (likes = 100, changes = {}) => reference({ platform: "substack", comparison: comparison(),
  metrics: { ...contract.newThreadsReference().metrics, likes: { value: likes, verified: true }, comments: { value: 1, verified: true } }, ...changes });
test("small verified counts are facts, never a recommendation or a popularity claim", () => {
  for (const ref of [substack(6), substack(0), substack(6, { comparison: comparison(1) })]) {
    const result = contract.evaluateThreadsReference(ref);
    assert.equal(result.status, "reference_only");
    assert.equal(result.evidenceLabel, "수치 확인됨 · 추천 여부 별도");
    assert.equal(contract.hasVerifiedThreadsReaction(ref), true);
    assert.throws(() => contract.assertThreadsReferencesReady([ref]), code("THREADS_REFERENCE_QUALITY_REQUIRED"));
  }
});
test("Threads needs observed 100k views plus full Korean context and observed audience evidence", () => {
  assert.equal(contract.evaluateThreadsReference(reference()).status, "recommended");
  for (const [value, verified, expected] of [[0, true, "reference_only"], [99999, true, "reference_only"],
    [100000, false, "pending"], [null, false, "pending"], [100000, true, "recommended"]]) {
    const ref = reference(); ref.metrics.views = { value, verified };
    assert.equal(contract.evaluateThreadsReference(ref).status, expected);
  }
  for (const field of ["koreanTitle", "summary", "suggestedTopic"])
    assert.equal(contract.evaluateThreadsReference(reference({ [field]: "English only explanation" })).status, "pending");
  for (const field of ["readNote", "author", "relevanceNote", "audienceNote"])
    assert.equal(contract.evaluateThreadsReference(reference({ [field]: "" })).status, "pending");
  assert.equal(contract.evaluateThreadsReference(reference({ audienceNote: "직장인 대상" })).status, "pending");
  assert.equal(contract.evaluateThreadsReference(reference({ audienceNote: "댓글에서 독자 반응과 질문을 아직 직접 확인하지 못했다." })).status, "pending");
  assert.equal(contract.evaluateThreadsReference(reference({ platform: "other" })).status, "reference_only");
});
test("Substack needs an absolute floor and five distinct comparable posts with a twofold median lift", () => {
  assert.equal(contract.evaluateThreadsReference(substack(10000, { comparison: undefined })).status, "pending");
  const passed = contract.evaluateThreadsReference(substack());
  assert.equal(passed.status, "recommended"); assert.equal(passed.comparisonMedian, 50);
  assert.equal(contract.evaluateThreadsReference(substack(100, { comparison: comparison(51) })).status, "reference_only");
  assert.equal(contract.evaluateThreadsReference(substack(100, { comparison: comparison(0) })).status, "pending");
  const even = comparison(); even.posts.push({ url: "https://example.substack.com/p/extra", likes: 80, publishedAt: "2026-10-06" });
  even.posts[0].likes = 20; even.posts[1].likes = 30; even.posts[2].likes = 40; even.posts[3].likes = 60; even.posts[4].likes = 70;
  assert.equal(contract.evaluateThreadsReference(substack(100, { comparison: even })).comparisonMedian, 50);
  for (const bad of [
    { ...comparison(), posts: comparison().posts.slice(0, 4) },
    { ...comparison(), posts: [...comparison().posts.slice(0, 4), comparison().posts[0]] },
    { ...comparison(), posts: [...comparison().posts.slice(0, 4), { ...comparison().posts[0], url: comparison().posts[0].url + "?r=reader&source=share" }] },
    { ...comparison(), posts: [...comparison().posts.slice(0, 4), { ...comparison().posts[0], url: reference().url + "?utm_source=email#part" }] },
    { ...comparison(), posts: [...comparison().posts.slice(0, 4), { ...comparison().posts[4], publishedAt: "2099-01-01" }] },
    { ...comparison(), basis: "Looks popular" },
  ]) assert.equal(contract.evaluateThreadsReference(substack(100, { comparison: bad })).status, "pending");
});
test("comparison schema validates HTTPS, integer likes, date-only values, bounded rows and strict fields", () => {
  for (const patch of [{ url: "http://example.com/post" }, { likes: -1 }, { likes: 2.5 }, { publishedAt: "2026-10-01T00:00:00.000Z" },
    { publishedAt: "2026-02-31" }, { author: "Injected" }]) {
    const value = comparison(); value.posts[0] = { ...value.posts[0], ...patch };
    assert.throws(() => contract.parseThreadsReferences([substack(100, { comparison: value })]), code("THREADS_REFERENCES_INVALID"));
  }
  const value = comparison(); value.posts = Array(11).fill(value.posts[0]);
  assert.throws(() => contract.parseThreadsReferences([substack(100, { comparison: value })]), code("THREADS_REFERENCES_INVALID"));
  for (const patch of [{ observedAt: "2099-01-01T00:00:00.000Z" }, { publishedAt: "2099-01-01" }, { publishedAt: "2026-10-26T23:00:00.000Z" }])
    assert.equal(contract.evaluateThreadsReference(reference(patch)).status, "pending");
});
test("offset publication timestamps compare actual instants across the KST midnight boundary", async () => {
  const clocked = await contractAt("2026-10-25T16:05:00.000Z");
  const result = clocked.evaluateThreadsReference(reference({ publishedAt: "2026-10-26T00:30:00+09:00", observedAt: "2026-10-25T16:00:00.000Z" }));
  assert.equal(result.status, "recommended");
});
test("date-only source and comparison publications use today's and the observation's KST calendar dates", async () => {
  const clocked = await contractAt("2026-10-25T15:40:00.000Z"), value = comparison();
  value.posts[4].publishedAt = "2026-10-26";
  const fields = { publishedAt: "2026-10-26", observedAt: "2026-10-25T15:30:00.000Z" };
  assert.equal(clocked.evaluateThreadsReference(reference(fields)).status, "recommended");
  const result = clocked.evaluateThreadsReference(substack(100, { ...fields, comparison: value }));
  assert.equal(result.status, "recommended"); assert.equal(result.comparisonMedian, 50);
});
test("real future instants and future KST calendar dates still block recommendation and comparison medians", async () => {
  const clocked = await contractAt("2026-10-25T16:00:00.000Z"), observedAt = "2026-10-25T15:40:00.000Z";
  for (const publishedAt of ["2026-10-26T00:50:00+09:00", "2026-10-26T02:00:00+09:00", "2026-10-27"])
    assert.equal(clocked.evaluateThreadsReference(reference({ publishedAt, observedAt })).status, "pending");
  const value = comparison(); value.posts[4].publishedAt = "2026-10-27";
  const result = clocked.evaluateThreadsReference(substack(100, { publishedAt: "2026-10-26", observedAt, comparison: value }));
  assert.equal(result.status, "pending"); assert.equal(result.comparisonMedian, null);
});
test("legacy observations remain readable with empty context defaults and require evidence before new use", () => {
  const legacy = reference();
  for (const key of ["koreanTitle", "summary", "suggestedTopic", "relevanceNote", "audienceNote"]) delete legacy[key];
  const parsed = contract.parseThreadsReferences([legacy])[0];
  assert.equal(parsed.koreanTitle, ""); assert.equal(parsed.comparison, undefined);
  assert.equal(contract.evaluateThreadsReference(parsed).status, "pending");
});
test("a Threads job pins parent brief, selected observations, existing posts and the authorized company document", async () => {
  const { server, store, accessChecks } = await serverHarness();
  const input = await server.createThreadsJobInput(actor, item(), "threads");
  assert.equal(input.topic.brief.one, "A chosen question");
  assert.equal(input.topic.reference_items[0].readScope, "full");
  assert.equal(input.topic.reference_items[0].metrics.views.value, 100000);
  assert.equal(input.target.posts[0], "An existing paragraph");
  assert.equal(input.canonical.version, 10);
  assert.equal(input.canonical.body, "Approved procedure and examples");
  assert.equal(accessChecks(), 1);
  assert.ok(store.queries.some(query => query.table === "os_records" && query.filters.some(([key, value]) => key === "owner_id" && value === owner)));
  assert.ok(store.queries.some(query => query.table === "os_documents" && query.filters.some(([key, value]) => key === "title" && value === server.THREADS_CANON_TITLE)));
});
test("new reference-based drafting rejects weak evidence while preparation and review remain available", async () => {
  const parent = topic(); parent.metadata.reference_items = [substack(6)];
  const { server, accessChecks } = await serverHarness({ topics: [parent] });
  await assert.rejects(server.createThreadsJobInput(actor, item(), "threads"),
    error => error.status === 422 && error.code === "THREADS_REFERENCE_QUALITY_REQUIRED");
  assert.equal(accessChecks(), 0);
  for (const proc of ["topic", "brief", "review"])
    assert.equal((await server.createThreadsJobInput(actor, proc === "review" ? item() : parent, proc)).proc, proc);
});
test("ordinary direct Threads drafts without the reference workflow retain their existing path", async () => {
  const parent = record(topicId, { brief: { one: "A direct insight" } });
  const { server } = await serverHarness({ topics: [parent] });
  const input = await server.createThreadsJobInput(actor, item(), "threads");
  assert.equal(input.topic.reference_items.length, 0);
  assert.equal(input.topic.brief.one, "A direct insight");
});
test("historical snapshots retain their original fingerprint and are not retroactively blocked", async () => {
  const parent = topic();
  const legacy = reference({ readScope: "partial" });
  for (const key of ["koreanTitle", "summary", "suggestedTopic", "relevanceNote", "audienceNote"]) delete legacy[key];
  parent.metadata.reference_items = [legacy];
  const { server } = await serverHarness({ topics: [parent] });
  const sourceInput = await server.threadsSourceInput(item(), "threads");
  for (const key of ["koreanTitle", "summary", "suggestedTopic", "relevanceNote", "audienceNote"]) delete sourceInput.topic.reference_items[0][key];
  const { version: targetVersion, ...target } = sourceInput.target;
  const { version: topicVersion, ...sourceTopic } = sourceInput.topic;
  void targetVersion; void topicVersion;
  const originalKey = crypto.createHash("sha256").update(JSON.stringify({ target, topic: sourceTopic })).digest("hex");
  const input = { ...sourceInput, schemaVersion: 1, workflow: contract.THREADS_REFERENCE_WORKFLOW, proc: "threads", canonical: await server.threadsCanonicalSnapshot(actor) };
  const job = { stage: "completed", metadata: { proc: "threads", threadsInput: input, threadsInputKey: originalKey } };
  await server.assertThreadsJobCurrent(item(), job);
  assert.equal(server.getThreadsJobInput(job), input);
  parent.metadata.reference_items[0].summary = "새롭게 추가한 요약";
  await assert.rejects(server.assertThreadsJobCurrent(item(), job), code("THREADS_INPUT_CHANGED"));
});
async function weakHistoricalWork() {
  const parent = topic(), draft = item(); parent.metadata.reference_items = [substack(6)];
  const { server } = await serverHarness({ topics: [parent] });
  const sourceInput = await server.threadsSourceInput(draft, "threads");
  const input = { ...sourceInput, schemaVersion: 1, workflow: contract.THREADS_REFERENCE_WORKFLOW, proc: "threads", canonical: await server.threadsCanonicalSnapshot(actor) };
  const job = { ...record("99999999-9999-4999-8999-999999999999", { proc: "threads", targetId: draft.id,
    threadsInput: input, threadsInputKey: server.threadsInputKey(input) }), record_type: "ai_job", status: "backlog", stage: "queued" };
  return { server, draft, job };
}
test("historical queued and blocked snapshots recheck quality while running and completed snapshots remain usable", async () => {
  const { server, draft, job } = await weakHistoricalWork();
  for (const status of ["backlog", "blocked"])
    await assert.rejects(server.assertThreadsJobCurrent(draft, { ...job, status }), code("THREADS_REFERENCE_QUALITY_REQUIRED"));
  for (const [status, stage] of [["active", "running"], ["done", "completed"]])
    await server.assertThreadsJobCurrent(draft, { ...job, status, stage });
});
test("createJob cannot reuse a weak queued snapshot but preserves an already running job", async () => {
  const { server, draft, job } = await weakHistoricalWork();
  const db = { from() { const filters = []; return { select() { return this; }, is() { return this; }, in() { return this; }, limit() { return this; },
    eq(key, value) { filters.push([key, value]); return this; },
    async maybeSingle() { return { data: filters.some(([key, value]) => key === "id" && value === draft.id) ? draft : job, error: null }; },
  }; } };
  const api = await load("lib/server/content-automation-v07.ts", {
    "./shortform-production": { shortformJobInput: () => null, assertShortformJobCurrent: () => {} }, "./threads-reference": server,
    "node:crypto": crypto, "@/lib/http": { ApiError }, "@/lib/supabase/server": { createServiceSupabase: () => db },
  });
  await assert.rejects(api.createJob(actor, { proc: "threads", targetId: draft.id }), code("THREADS_REFERENCE_QUALITY_REQUIRED"));
  job.status = "active"; job.stage = "running";
  assert.equal((await api.createJob(actor, { proc: "threads", targetId: draft.id })).reused, true);
});
test("worker dispatch blocks weak queued evidence before claiming while completed instructions and running results remain available", async () => {
  const { server, draft, job } = await weakHistoricalWork(), claimed = [], blocked = [];
  const run = { id: "run", owner_id: owner, browser_id: "browser", status: "running", via: "now", job_ids: [] };
  const jobs = [job, { ...record("good"), record_type: "ai_job", status: "backlog", stage: "queued", metadata: { space: "personal", proc: "card-fill" } }];
  const db = { from() { return { select() { return this; }, eq() { return this; }, gte() { return this; },
    async maybeSingle() { return { data: run, error: null }; }, async limit() { return { data: [run], error: null }; } }; },
  async rpc(name, input) { claimed.push({ name, id: input.p_job }); return { data: jobs.find(row => row.id === input.p_job), error: null }; } };
  const api = await load("lib/server/content-automation-worker.ts", {
    "@/lib/shortform-production": {}, "./shortform-production": { validateShortformJobResult: (_job, result) => result }, "@/lib/http": { ApiError },
    "@/lib/supabase/server": { createServiceSupabase: () => db }, "@/lib/content-automation-results": { RESULT_EXAMPLES: {}, parseAutomationResult: (_proc, result) => result },
    "@/lib/server/content-automation-notifications": {}, "./threads-reference": server,
    "./content-automation-v07": { assertHumanOwner: value => value.ownerId, AUTOMATION_PROCS: ["threads", "card-fill"],
      getRegisteredBrowser: async () => ({ id: "browser", is_main: true }), getRunRules: async () => ({ per_run: 5, daily_max: 10, notify: false }),
      getPersonalRecord: async (_actor, id) => id === draft.id ? draft : job, listPersonalRecords: async () => jobs, orderedJobs: rows => rows,
      updatePersonalRecord: async (_actor, row, changes) => { blocked.push({ ...row, ...changes }); return { ...row, ...changes }; } },
  });
  const result = await api.workerNext(actor, new Request("https://os.test"), { via: "now", runId: run.id });
  assert.equal(result.job.id, "good"); assert.deepEqual(claimed.map(value => value.id), ["good"]);
  assert.equal(blocked[0].metadata.failureCode, "THREADS_REFERENCE_QUALITY_REQUIRED");
  assert.equal((await api.jobInstructions(actor, { ...job, status: "done", stage: "completed" })).target, job.metadata.threadsInput);
  job.status = "active"; job.stage = "running"; job.metadata.runId = run.id; job.metadata.browserId = "browser"; run.job_ids = [job.id];
  await api.workerCompleteJob(actor, new Request("https://os.test"), { runId: run.id, jobId: job.id, failed: false, result: { posts: ["Completed draft"] } });
  assert.equal(claimed.at(-1).name, "os_ai_complete_job");
});
test("retry and queued paste reject weak historical evidence while running paste and completed adoption preserve results", async () => {
  const { server, draft, job } = await weakHistoricalWork(), writes = [];
  const api = await load("app/api/v1/content/automation/[resource]/[id]/[action]/route.ts", {
    "next/server": { NextResponse: Response }, zod,
    "@/lib/http": { ApiError, parseJson: request => request.json(), apiErrorResponse: error => Response.json({ error: { code: error.code } }, { status: error.status ?? 500 }) },
    "@/lib/server/auth": { authenticateRequest: async () => actor }, "@/lib/supabase/server": { createServiceSupabase: () => ({}) },
    "@/lib/server/content-automation-v07": { assertHumanOwner: value => value.ownerId, assertSameOrigin: () => {}, assertCanEdit: access => access.record,
      AUTOMATION_PROCS: ["topic", "brief", "threads", "review"], getPersonalRecord: async (_actor, id) => id === draft.id ? draft : job,
      getContentRecord: async () => ({ record: draft, own: true }), getItemJob: async () => job,
      updatePersonalRecord: async (_actor, row, changes) => { const saved = { ...row, ...changes }; writes.push(saved); return saved; } },
    "@/lib/threads-reference": contract, "@/lib/server/threads-reference": server,
    "@/lib/server/shortform-production": { validateShortformJobResult: (_job, result) => result, assertShortformJobCurrent: () => {}, invalidateShortformVideo: (_row, metadata) => metadata },
    "@/lib/content-automation-results": { parseAutomationResult: (_proc, result) => result }, "@/lib/server/content-automation-validators": {},
    "@/lib/threads-posts": {}, "@/lib/content-comments": {}, "@/lib/server/channel-comments": {}, "@/lib/server/content-automation-worker": {},
  });
  const send = (action, body = {}, resource = "jobs") => api.POST(new Request("https://os.test", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ resource, id: resource === "jobs" ? job.id : draft.id, action }) });
  job.status = "blocked"; job.stage = "failed";
  assert.equal((await send("requeue")).status, 422); assert.equal(writes.length, 0);
  job.status = "backlog"; job.stage = "queued";
  assert.equal((await send("paste", { result: { posts: ["Weak draft"] } })).status, 422); assert.equal(writes.length, 0);
  job.status = "active"; job.stage = "running"; job.metadata.via = "copy";
  assert.equal((await send("paste", { result: { posts: ["Started before policy update"] } })).status, 200);
  job.status = "done"; job.stage = "completed"; job.metadata.result = { posts: ["Completed before policy update"] };
  assert.equal((await send("adopt", { jobId: job.id, version: draft.version }, "items")).status, 200);
  assert.deepEqual(writes.at(-2).metadata.posts, ["Completed before policy update"]);
});
test("a missing, unreadable, noncanonical, restricted or outdated company document blocks instead of falling back", async () => {
  const doc = { id: "77777777-7777-4777-8777-777777777777", title: "쓰레드 자동화 운영 정본 — 안저 · Aside × OS", status: "canonical", reader_scope: "all", current_version: 10, content_md: "Rules" };
  for (const docs of [[], [doc,{...doc,id:"88888888-8888-4888-8888-888888888888"}], [{ ...doc, status: "draft" }], [{ ...doc, reader_scope: "restricted" }], [{ ...doc, current_version: 9 }], [{ ...doc, content_md: "" }]]) {
    const { server } = await serverHarness({ docs });
    await assert.rejects(server.createThreadsJobInput(actor, item(), "threads"), code("THREADS_CANON_UNAVAILABLE"));
  }
  const { server } = await serverHarness({ readable: false });
  await assert.rejects(server.createThreadsJobInput(actor, item(), "threads"), code("THREADS_CANON_UNAVAILABLE"));
  const context=await server.threadsCollectionContext(actor);
  assert.equal(context.canonicalUrl,undefined);
  assert.ok(context.error);
});
test("reference request identity reuses the same URL without fragments or campaign tracking",async()=>{
  const {server}=await serverHarness();
  assert.equal(server.threadsReferenceRequestId("https://example.com/p/one?utm_source=mail#part"),server.threadsReferenceRequestId("https://example.com/p/one"));
  assert.notEqual(server.threadsReferenceRequestId("https://example.com/p/one?id=1"),server.threadsReferenceRequestId("https://example.com/p/one?id=2"));
});
test("a transient parent-topic read stays retryable during job creation and current-input validation",async()=>{
  const {server:healthy}=await serverHarness();
  const draft=item(), input=await healthy.createThreadsJobInput(actor,draft,"threads");
  const job={metadata:{proc:"threads",threadsInput:input,threadsInputKey:healthy.threadsInputKey(input)}};
  const {server:unavailable}=await serverHarness({topicReadError:{message:"Temporary database connection failure"}});
  const retryable=error=>error.status===503&&error.code==="THREADS_TOPIC_READ_FAILED";
  await assert.rejects(unavailable.createThreadsJobInput(actor,draft,"threads"),retryable);
  await assert.rejects(unavailable.assertThreadsJobCurrent(draft,job),retryable);
  const {server:missing}=await serverHarness({topics:[]});
  await assert.rejects(missing.assertThreadsJobCurrent(draft,job),error=>error.status===409&&error.code==="THREADS_TOPIC_UNAVAILABLE");
});
test("topic/brief and review use this workflow only for Threads while ordinary channel jobs are untouched", async () => {
  const { server, store } = await serverHarness();
  for (const proc of ["topic", "brief", "review", "card-fill", "shorts-cut"])
    assert.equal(await server.createThreadsJobInput(actor, record(topicId), proc), null);
  assert.equal(store.queries.length, 0);
  assert.equal((await server.createThreadsJobInput(actor, source(), "topic")).proc, "topic");
  assert.equal((await server.createThreadsJobInput(actor, item(), "review")).proc, "review");
  await assert.rejects(server.createThreadsJobInput(actor, null, "threads"), code("THREADS_TARGET_REQUIRED"));
  await assert.rejects(server.createThreadsJobInput(actor, source(), "threads"), code("THREADS_TARGET_INVALID"));
});
test("human selection, same-owner parent and current source facts are required; version-only sharing does not stale a draft", async () => {
  const waiting = topic(); waiting.stage = "candidate";
  const early = await serverHarness({ topics: [waiting] });
  await assert.rejects(early.server.createThreadsJobInput(actor, item(), "threads"), code("THREADS_HUMAN_SELECTION_REQUIRED"));
  const foreign = topic(); foreign.owner_id = other;
  const crossOwner = await serverHarness({ topics: [foreign] });
  await assert.rejects(crossOwner.server.createThreadsJobInput(actor, item(), "threads"), code("THREADS_TOPIC_UNAVAILABLE"));
  const parent = topic(), { server } = await serverHarness({ topics: [parent] });
  const draft = item(), input = await server.createThreadsJobInput(actor, draft, "threads");
  const job = { metadata: { proc: "threads", threadsInput: input, threadsInputKey: server.threadsInputKey(input) } };
  await server.assertThreadsJobCurrent({ ...draft, version: 2, metadata: { ...draft.metadata, shared: "team" } }, job);
  await assert.rejects(server.assertThreadsJobCurrent({ ...draft, metadata: { ...draft.metadata, posts: ["Changed"] } }, job), code("THREADS_INPUT_CHANGED"));
  parent.metadata.sourceRef = "https://example.com/changed";
  await assert.rejects(server.assertThreadsJobCurrent(draft, job), code("THREADS_INPUT_CHANGED"));
  assert.throws(() => server.getThreadsJobInput({ metadata: { proc: "threads" } }), code("THREADS_JOB_INPUT_REQUIRED"));
});

async function routeHarness() {
  const rows = [source(), { ...source(), id: secondRefId, metadata: { ...source().metadata, reference_items: [reference({ id: "unselected", title: "Do not copy" })] } }, topic()];
  const created = [];
  const personal = async (who, id, type) => {
    const row = rows.find(row => row.id === id && row.owner_id === who.ownerId && row.record_type === type);
    if (!row) throw new ApiError(404, "AUTOMATION_NOT_FOUND", "Not found"); return row;
  };
  const api = await load("app/api/v1/content/automation/[resource]/route.ts", {
    "next/server": { NextResponse: Response }, zod,
    "@/lib/http": { ApiError, parseJson: request => request.json(), apiErrorResponse: error => Response.json({ error: { code: error.code, message: error.message } }, { status: error.status ?? 500 }) },
    "@/lib/server/auth": { authenticateRequest: async () => actor },
    "@/lib/supabase/server": { createServiceSupabase: () => ({ from: () => ({ select() { return this; }, eq() { return this; }, is() { return this; }, limit() { return this; }, async maybeSingle() { return { data: null, error: null }; } }) }) },
    "@/lib/server/content-automation-validators": {}, "@/lib/content-automation-schedule": {}, "@/lib/content-automation-csv": {},
    "@/lib/threads-reference": contract,
    "@/lib/server/threads-reference": { getThreadsJobInput: job=>job.metadata.threadsInput??null, threadsReferenceRequestId: url => "reference:" + url, threadsCollectionContext: async () => ({ canonicalTitle: "Procedure", canonicalUrl: "https://os.test/knowledge" }) },
    "@/lib/server/content-automation-v07": {
      assertHumanOwner: value => value.ownerId, assertSameOrigin: () => {}, AUTOMATION_CHANNELS: ["card", "shorts", "threads"],
      AUTOMATION_PROCS: ["topic", "brief", "threads", "review"], getPersonalRecord: personal,
      listPersonalRecords: async (_actor, type, limit, scope) => rows.filter(row=>row.record_type===type).filter(row => scope === "references" ? row.metadata.kind === contract.THREADS_REFERENCE_KIND : row.metadata.kind !== contract.THREADS_REFERENCE_KIND).slice(0, limit),
      createPersonalRecord: async (_actor, type, input) => { const row = { ...record(crypto.randomUUID()), ...input, record_type: type }; created.push(row); return row; },
    },
  });
  const post = (body, resource = "topics") => api.POST(new Request(`https://os.test/api/v1/content/automation/${resource}`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ resource }) });
  return { api, rows, created, post };
}
test("reference creation and human promotion use existing private topics and copy only selected observations", async () => {
  const { post, created } = await routeHarness();
  const saved = await post({ title: "Source", source: "reference", kind: contract.THREADS_REFERENCE_KIND,
    editorial_workflow: contract.THREADS_REFERENCE_WORKFLOW, reference_items: [reference()], requestId: "reference-request-1" });
  assert.equal(saved.status, 201);
  assert.equal(created[0].metadata.kind, contract.THREADS_REFERENCE_KIND);
  const selected = await post({ title: "Chosen topic", referenceIds: [refId], requestId: "selected-request-1" });
  assert.equal(selected.status, 201);
  const body = await selected.json();
  assert.equal(body.topic.metadata.reference_items.length, 1);
  assert.equal(body.topic.metadata.reference_items[0].id, "reference-a");
  assert.equal(body.topic.metadata.kind, undefined);
  assert.equal(body.topic.metadata.shared, undefined);
  assert.equal(body.topic.metadata.editorial_workflow, contract.THREADS_REFERENCE_WORKFLOW);
});
test("promotion refuses another owner's record, non-reference records and client replacement of server evidence", async () => {
  const { post, rows } = await routeHarness();
  rows[0].owner_id = other;
  assert.equal((await post({ title: "No", referenceIds: [refId] })).status, 404);
  assert.equal((await post({ title: "No", referenceIds: [topicId] })).status, 422);
  assert.equal((await post({ title: "No", referenceIds: [secondRefId], reference_items: [reference()] })).status, 422);
});
test("weak evidence stays savable but direct, selected and AI-derived topic promotion fail before insert", async () => {
  const { post, rows, created } = await routeHarness(), weak = substack(6);
  const saved = await post({ title: "Weak source", kind: contract.THREADS_REFERENCE_KIND,
    editorial_workflow: contract.THREADS_REFERENCE_WORKFLOW, reference_items: [weak] });
  assert.equal(saved.status, 201); assert.equal(created.length, 1);
  rows[0].metadata.reference_items = [weak];
  const jobId = "99999999-9999-4999-8999-999999999999";
  rows.push({ ...record(jobId), record_type: "ai_job", stage: "completed", metadata: { space: "personal", proc: "topic",
    result: { candidates: [{ title: "Weak AI topic", source: "Observed source" }] }, threadsInput: { topic: { reference_items: [weak] } } } });
  for (const body of [{ title: "No", referenceIds: [refId] }, { title: "No", reference_items: [weak] },
    { title: "No", sourceJobId: jobId, candidateIndex: 0 }, { title: "No", editorial_workflow: contract.THREADS_REFERENCE_WORKFLOW }]) {
    const response = await post(body), error = (await response.json()).error;
    assert.equal(response.status, 422); assert.equal(error.code, "THREADS_REFERENCE_QUALITY_REQUIRED");
    assert.match(error.message, /추천 기준/); assert.equal(created.length, 1);
  }
});
test("new reference-based production blocks weak evidence while unrelated and ordinary direct paths remain available", async () => {
  const { post, rows, created } = await routeHarness();
  rows[2].metadata.reference_items = [substack(6)];
  assert.equal((await post({ title: "Draft", topicId, channel: "threads" }, "items")).status, 422);
  assert.equal(created.length, 0);
  assert.equal((await post({ title: "Card", topicId, channel: "card" }, "items")).status, 201);
  delete rows[2].metadata.editorial_workflow; delete rows[2].metadata.reference_items;
  assert.equal((await post({ title: "Direct draft", topicId, channel: "threads" }, "items")).status, 201);
  assert.equal((await post({ title: "Direct topic" })).status, 201);
});
test("topic start checks reference quality before its production RPC without changing other channel paths", async () => {
  const parent = topic(), writes = [];
  const api = await load("app/api/v1/content/automation/[resource]/[id]/[action]/route.ts", {
    "next/server": { NextResponse: Response }, zod,
    "@/lib/http": { ApiError, parseJson: request => request.json(), apiErrorResponse: error => Response.json({ error: { code: error.code } }, { status: error.status ?? 500 }) },
    "@/lib/server/auth": { authenticateRequest: async () => actor },
    "@/lib/supabase/server": { createServiceSupabase: () => ({ rpc: async (name, input) => { writes.push({ name, input }); return { data: { started: true }, error: null }; } }) },
    "@/lib/server/content-automation-v07": { assertHumanOwner: value => value.ownerId, assertSameOrigin: () => {},
      AUTOMATION_PROCS: ["topic", "brief", "threads", "review"], getPersonalRecord: async () => parent },
    "@/lib/threads-reference": contract, "@/lib/server/threads-reference": {},
    "@/lib/server/shortform-production": {}, "@/lib/content-automation-results": {}, "@/lib/server/content-automation-validators": {},
    "@/lib/threads-posts": {}, "@/lib/content-comments": {}, "@/lib/server/channel-comments": {}, "@/lib/server/content-automation-worker": {},
  });
  const start = channels => api.POST(new Request("https://os.test", { method: "POST", body: JSON.stringify({ version: 1, brief: parent.metadata.brief, channels }) }),
    { params: Promise.resolve({ resource: "topics", id: topicId, action: "start" }) });
  parent.metadata.reference_items = [substack(6)];
  assert.equal((await start({ threads: {} })).status, 422); assert.equal(writes.length, 0);
  assert.equal((await start({ card: {} })).status, 200); assert.equal(writes.length, 1);
  parent.metadata.reference_items = [reference()];
  assert.equal((await start({ threads: {} })).status, 200); assert.equal(writes.length, 2);
  delete parent.metadata.editorial_workflow; delete parent.metadata.reference_items;
  assert.equal((await start({ threads: {} })).status, 200); assert.equal(writes.length, 3);
});
test("selecting an AI candidate copies the owned job's chosen evidence and derives its title from the server result",async()=>{
  const {post,rows}=await routeHarness();
  const jobId="99999999-9999-4999-8999-999999999999";
  rows.push({...record(jobId),record_type:"ai_job",stage:"completed",metadata:{space:"personal",proc:"topic",
    result:{candidates:[{title:"Actual candidate",why:"Why",source:"Evidence summary"}]},
    threadsInput:{topic:{reference_items:[reference()]}}}});
  const response=await post({title:"Client replacement",sourceJobId:jobId,candidateIndex:0});
  assert.equal(response.status,201);
  const selected=(await response.json()).topic;
  assert.equal(selected.title,"Actual candidate");
  assert.equal(selected.metadata.editorial_workflow,contract.THREADS_REFERENCE_WORKFLOW);
  assert.equal(selected.metadata.reference_items[0].id,"reference-a");
  assert.equal(selected.metadata.sourceJobId,jobId);
  assert.equal((await post({title:"No",sourceJobId:jobId,candidateIndex:0,referenceIds:[refId]})).status,422);
  assert.equal((await post({title:"No",sourceJobId:jobId,candidateIndex:1})).status,409);
  rows.at(-1).owner_id=other;
  assert.equal((await post({title:"No",sourceJobId:jobId,candidateIndex:0})).status,404);
});
test("reference and topic lists are separate and cannot request a shared reference library", async () => {
  const { api } = await routeHarness();
  const get = resource => api.GET(new Request(`https://os.test/api/v1/content/automation/${resource}`), { params: Promise.resolve({ resource }) });
  assert.equal((await (await get("references")).json()).references.length, 2);
  assert.equal((await (await get("topics")).json()).topics.length, 1);
  const shared = await api.GET(new Request("https://os.test/api/v1/content/automation/references?scope=team"), { params: Promise.resolve({ resource: "references" }) });
  assert.equal(shared.status, 400);
});
test("a large reference library cannot consume the ordinary-topic list limit",async()=>{
  const rows=[...Array.from({length:501},(_,index)=>({...source(),id:`ref-${index}`})),topic()];
  const calls=[];
  const db={from(){let selected=rows;return {
    select(){return this;},eq(key,value){calls.push(key);selected=selected.filter(row=>(key.startsWith("metadata->>")?row.metadata[key.slice(11)]:row[key])===value);return this;},
    is(key,value){selected=selected.filter(row=>row[key]===value);return this;},
    or(filter){calls.push("kind-filter");assert.equal(filter,"metadata->>kind.is.null,metadata->>kind.neq.threads_reference");selected=selected.filter(row=>row.metadata.kind!==contract.THREADS_REFERENCE_KIND);return this;},
    order(){return this;},async limit(limit){calls.push("limit");return {data:selected.slice(0,limit),error:null};},
  };}};
  const api=await load("lib/server/content-automation-v07.ts",{
    "./shortform-production":{},"./threads-reference":{},"node:crypto":crypto,
    "@/lib/http":{ApiError},"@/lib/supabase/server":{createServiceSupabase:()=>db},
  });
  const topics=await api.listPersonalRecords(actor,"content_topic",100,"topics");
  assert.equal(topics.length,1);assert.equal(topics[0].id,topicId);
  assert.ok(calls.indexOf("kind-filter")<calls.indexOf("limit"));
});

async function workerHarness(failureStatus=409,{targetReadStatus}={}){
  const jobs=[{...record("bad"),record_type:"ai_job",status:"backlog",stage:"queued",metadata:{space:"personal",proc:"threads",...(targetReadStatus?{targetId:topicId}:{})}},
    {...record("good"),record_type:"ai_job",status:"backlog",stage:"queued",metadata:{space:"personal",proc:"card-fill"}}];
  const run={id:"run",owner_id:owner,browser_id:"browser",status:"running",via:"now",job_ids:[]};
  const claimed=[],blocked=[];
  const db={from(){return {select(){return this;},eq(){return this;},gte(){return this;},
    async maybeSingle(){return {data:run,error:null};},async limit(){return {data:[run],error:null};}};},
    async rpc(_name,input){claimed.push(input.p_job);return {data:jobs.find(job=>job.id===input.p_job),error:null};}};
  const api=await load("lib/server/content-automation-worker.ts",{
    "@/lib/shortform-production":{},"./shortform-production":{},"@/lib/http":{ApiError},
    "@/lib/supabase/server":{createServiceSupabase:()=>db},"@/lib/content-automation-results":{RESULT_EXAMPLES:{"card-fill":"{}"}},
    "@/lib/server/content-automation-notifications":{},
    "./threads-reference":{getThreadsJobInput:job=>{if(job.id==="bad"){if(targetReadStatus)return {};throw new ApiError(failureStatus,"THREADS_JOB_INPUT_REQUIRED","Recreate the job");}return null;},assertThreadsJobCurrent:async()=>{},threadsInputInstructions:()=>""},
    "./content-automation-v07":{assertHumanOwner:actor=>actor.ownerId,AUTOMATION_PROCS:["threads","card-fill"],
      getRegisteredBrowser:async()=>({id:"browser",is_main:true}),getRunRules:async()=>({per_run:5,daily_max:10}),
      getPersonalRecord:async()=>{throw new ApiError(targetReadStatus,"TARGET_READ_FAILED","Target read failed");},
      listPersonalRecords:async()=>jobs,orderedJobs:rows=>rows,
      updatePersonalRecord:async(_actor,job,changes)=>{blocked.push({...job,...changes});return {...job,...changes};}},
  });
  return {api,claimed,blocked};
}
test("an invalid first job is blocked before a lease and does not starve the next channel's work",async()=>{
  const {api,claimed,blocked}=await workerHarness();
  const result=await api.workerNext(actor,new Request("https://os.test"),{via:"now",runId:"run"});
  assert.deepEqual(claimed,["good"]);
  assert.equal(blocked[0].status,"blocked");
  assert.equal(blocked[0].metadata.failureCode,"THREADS_JOB_INPUT_REQUIRED");
  assert.equal(result.job.id,"good");
  assert.equal(result.blockedBeforeDispatch[0].id,"bad");
});
test("a temporary input-read failure does not claim or permanently block queued work",async()=>{
  const {api,claimed,blocked}=await workerHarness(503);
  await assert.rejects(api.workerNext(actor,new Request("https://os.test"),{via:"now",runId:"run"}),code("THREADS_JOB_INPUT_REQUIRED"));
  assert.equal(claimed.length,0);assert.equal(blocked.length,0);
});
test("a 503 target read stays retryable while only a missing target permanently blocks the job",async()=>{
  const temporary=await workerHarness(409,{targetReadStatus:503});
  await assert.rejects(temporary.api.workerNext(actor,new Request("https://os.test"),{via:"now",runId:"run"}),error=>error.status===503&&error.code==="TARGET_READ_FAILED");
  assert.equal(temporary.claimed.length,0);assert.equal(temporary.blocked.length,0);
  const missing=await workerHarness(409,{targetReadStatus:404});
  const result=await missing.api.workerNext(actor,new Request("https://os.test"),{via:"now",runId:"run"});
  assert.equal(missing.blocked[0].metadata.failureCode,"THREADS_TARGET_UNAVAILABLE");
  assert.equal(result.job.id,"good");assert.deepEqual(missing.claimed,["good"]);
});

async function genericRecordsHarness(path,currentMetadata={space:"personal",proc:"card-fill"}){
  const writes=[];
  const current={...record(refId,currentMetadata),record_type:"ai_job"};
  const db={from(table){let payload=null;const builder=new Proxy({}, {get(_target,key){
    if(key==="then")return resolve=>resolve({data:payload?{...current,...payload}:current,error:null,count:0});
    if(key==="maybeSingle"||key==="single")return async()=>({data:payload?{...current,...payload}:current,error:null});
    return (...args)=>{if(key==="insert"||key==="update"){payload=args[0];writes.push({table,kind:key,payload});}return builder;};
  }});return builder;}};
  const types={RECORD_TYPES:["ai_job","content_topic","content_publish","task","skill"]};
  const validation=await load("lib/record-validation.ts",{zod,"./record-types":types});
  const noOp=async()=>{};
  const modules={
    "@/lib/content-comments":{isCommentDraftPatch:()=>false},"@/lib/server/meeting-review":{assertReviewedMeetingTask:noOp},
    "@/lib/html-entities":{decodeHtmlEntities:value=>value},"@/lib/content-origin":{contentOrigin:()=>"own"},
    "@/lib/server/skill-source":{assertSkillSource:noOp},"next/server":{NextResponse:Response},zod,
    "@/lib/http":{ApiError,parseJson:request=>request.json(),apiErrorResponse:error=>Response.json({error:{code:error.code}},{status:error.status??500})},
    "@/lib/server/auth":{authenticateRequest:async()=>({...actor,id:owner,type:path.includes("agent-records")?"agent":"user",supabase:db}),requireAgentScope:()=>{}},
    "@/lib/record-types":types,"@/lib/record-validation":validation,
    "@/lib/content-pipeline":{protectedPipelineChange:()=>false},"@/lib/youtube-process/project":{protectedYoutubeChange:()=>false},
    "@/lib/appeal-decision-guard":{changesAppealDecision:()=>false,isAppealCandidatePackage:()=>false},
    "@/lib/development-requests":{isDevelopmentRequest:()=>false},"@/lib/development-links":{assertDevelopmentRequestLink:noOp},
    "@/lib/server/hr-legacy-menus":{assertLegacyLeaveWritable:noOp},"@/lib/team/dates":{},
    "@/lib/server/organization":{assertOrganization:noOp},"@/lib/supabase/server":{createServiceSupabase:()=>db},
    "@/lib/threads-reference":contract,
    "@/lib/threads-reference-record-guard":referenceRecordGuard,
  };
  const api=await load(path,modules);
  const send=(method,body)=>api[method](new Request("https://os.test",{method,body:JSON.stringify({organizationId:other,...body})}));
  return {send,writes,current};
}
test("both general record APIs refuse creating, injecting, clearing or changing a personal Threads job snapshot",async()=>{
  for(const path of ["app/api/v1/records/route.ts","app/api/v1/agent-records/route.ts"]){
    for(const metadata of [{space:"personal",proc:"threads"},{space:"personal",proc:"review",editorial_workflow:contract.THREADS_REFERENCE_WORKFLOW},
      {space:"personal",proc:"card-fill",threadsInput:{canonical:{body:"Forged"}}}]){
      const api=await genericRecordsHarness(path);
      const created=await api.send("POST",{recordType:"ai_job",title:"Forged",metadata});
      assert.equal(created.status,403,path);assert.equal((await created.json()).error.code,"THREADS_AUTOMATION_API_REQUIRED");
      const injected=await api.send("PATCH",{id:refId,expectedVersion:1,metadata});
      assert.equal(injected.status,403,path);assert.equal(api.writes.length,0);
    }
    const existing=await genericRecordsHarness(path,{space:"personal",proc:"threads",threadsInput:{canonical:{body:"Pinned"}}});
    assert.equal((await existing.send("PATCH",{id:refId,expectedVersion:1,metadata:{space:"personal",proc:"card-fill"}})).status,403);
    assert.equal((await existing.send("PATCH",{id:refId,expectedVersion:1,status:"done"})).status,403);
    assert.equal(existing.writes.length,0);
  }
});
test("the narrow general-record guard preserves unrelated personal AI jobs",async()=>{
  for(const path of ["app/api/v1/records/route.ts","app/api/v1/agent-records/route.ts"]){
    const api=await genericRecordsHarness(path);
    assert.equal((await api.send("POST",{recordType:"ai_job",title:"Ordinary card",metadata:{space:"personal",proc:"card-fill"}})).status,201,path);
    assert.equal((await api.send("PATCH",{id:refId,expectedVersion:1,title:"Edited ordinary card"})).status,200,path);
    assert.equal(api.writes.filter(write=>write.table==="os_records").length,2);
  }
});
