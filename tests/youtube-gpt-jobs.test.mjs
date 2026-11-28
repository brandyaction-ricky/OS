import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as gptDraft from "../lib/youtube-process/gpt-draft.ts";

// GPT 초안 (owner 2026-10-29, ③): the OS does a staff-AI job card with the company's GPT credit — the card's documents pasted in,
// one retry with the OS's format problems, and the job failed (not left hanging) when GPT cannot meet the format.
class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const source = await readFile(new URL("../lib/server/youtube-gpt-jobs.ts", import.meta.url), "utf8");

function load({ answers, complete }) {
  const calls = { prompts: [], completed: [], failed: [] };
  const docs = [{ id: "11111111-2222-3333-4444-555555555555", title: "발행 키트 정본", content_md: "정본 본문" }];
  const supabase = { from: () => ({ select: () => ({ in: (_col, ids) => ({ neq: async () => ({ data: docs.filter((doc) => ids.includes(doc.id)) }) }) }) }) };
  const modules = {
    "next/server": { after: () => undefined }, "@/lib/http": { ApiError }, "@/lib/supabase/server": { createServiceSupabase: () => supabase },
    "@/lib/youtube-process/gpt-draft": gptDraft, "./openai-credit": { creditTier: async () => "precise" }, "./youtube-process-ai": { displayName: async () => "PD" },
    "./youtube-process-stages": { readStages: async () => ({}) },
    "./content-model": { generateContentText: async (request) => { calls.prompts.push(request); return answers.shift(); } },
    "./youtube-ai-jobs": {
      staffJobRequestSchema: { parse: (value) => value },
      claimStaffJob: async (_agent, jobId, byGpt) => { assert.equal(byGpt, true, "GPT takes its own jobs only"); return { jobId, lease: "lease-1", instructions: "## 먼저 끝까지 열 문서 (doc_id로 엽니다)\n- 발행 키트 정본 (doc_id: 11111111-2222-3333-4444-555555555555)\nresult = { desc }" }; },
      completeStaffJob: async (_agent, input) => { calls.completed.push(input); return complete(input); },
      failStaffJob: async (_agent, input) => { calls.failed.push(input); return { closed: true }; },
      requestStaffJob: async () => ({ id: "job", status: "backlog" }),
    },
  };
  const compiled = { exports: {} };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: compiled, exports: compiled.exports, require: (name) => modules[name], console });
  return { jobs: compiled.exports, calls };
}
const owner = { id: "owner", name: "PD", team: "" };

test("GPT gets the card's documents, answers once more with the OS's format problem, and completes as the job owner's AI", async () => {
  let tries = 0;
  const { jobs, calls } = load({
    answers: ["not json", JSON.stringify({ result: { desc: "설명란 v1" } }), JSON.stringify({ desc: "설명란 v2" })],
    complete: (input) => { tries++; if (tries === 1) throw new ApiError(422, "KIT_INVALID", "설명란 첫 줄이 비었어요"); return { done: true, desc: input.result.desc }; },
  });
  // first answer is not JSON → asked again; the second is wrapped in { result } and rejected by the save → asked again with that problem
  await assert.rejects(jobs.runGptJob("job-1", owner, "precise"), /형식을 맞추지 못했어요/);
  assert.equal(calls.prompts.length, 2, "two tries at most");
  assert.ok(calls.prompts[0].cachedPrefix.includes("=== [발행 키트 정본]") && calls.prompts[0].cachedPrefix.includes("정본 본문"), "the card's document is pasted in");
  assert.equal(calls.prompts[0].model, "gpt-6-astra");
  assert.equal(calls.prompts[0].effort, "high");
  assert.equal(calls.prompts[0].jsonSchema, undefined, "any one JSON object: the card describes its own result shape");
  assert.ok(calls.prompts[1].prompt.includes("JSON 객체 하나로만"), "the second try says what was wrong");
  assert.deepEqual(JSON.parse(JSON.stringify(calls.completed.map((input) => input.result))), [{ desc: "설명란 v1" }], "{ result: … } is unwrapped");
  assert.equal(calls.failed.length, 1, "a job GPT could not finish is failed so the screen shows 다시 만들기");
  assert.match(calls.failed[0].reason, /설명란 첫 줄이 비었어요/);

  const ok = load({ answers: [JSON.stringify({ desc: "설명란" })], complete: (input) => ({ done: true, desc: input.result.desc }) });
  assert.deepEqual(await ok.jobs.runGptJob("job-2", owner, "saving"), { done: true, desc: "설명란" });
  assert.equal(ok.calls.prompts[0].model, "gpt-6.1-sol");
  assert.equal(ok.calls.failed.length, 0);
});

test("only the derivative tasks and the 카드뉴스 draft take GPT, and a draft says whose it is", () => {
  assert.deepEqual([...gptDraft.GPT_DRAFT_TASKS], ["kit", "column", "short-topics", "short-script", "card", "short-recycle"]);
  assert.deepEqual([...gptDraft.GPT_AUTO_TASKS], ["kit", "column", "short-topics"], "숏폼 대본 waits for the PD's topic and formula");
  assert.equal(gptDraft.isGptTask("script"), false, "the 원고 stays with the staff AI (원고 공정 정본 §12-1)");
  assert.equal(gptDraft.draftTag("유쓰", "gpt-6-astra"), "GPT 초안 · GPT-6 Astra");
  assert.equal(gptDraft.draftTag("유쓰", "claude-opus-5-5"), "AI 초안 · 유쓰");
});

// 업로드 뒤 저절로 (요청 11-25): after a longform's upload the 칼럼 goes public on MYIN and the 숏폼 5편 are made, with nothing made twice.
function loadFollow({ stages, myin = [], made = [], fail = new Set() }) {
  const calls = { myin, made, notices: [], requested: [] };
  let after;
  const modules = {
    "next/server": { after: (fn) => { after = fn; } }, "@/lib/http": { ApiError }, "@/lib/supabase/server": { createServiceSupabase: () => ({}) },
    "@/lib/youtube-process/gpt-draft": gptDraft, "./openai-credit": { creditTier: async () => "saving" }, "./youtube-process-ai": { displayName: async () => "PD" },
    "@/lib/seo-column": { columnEmptyPlaces: (html, fills, auto) => (html.match(/data-slot="([^"]+)"/g) ?? []).map((m) => m.slice(11, -1)).filter((slot) => !fills[slot] && !(slot === "hero" && auto.hero) && !(slot === "video" && auto.video)) },
    "./youtube-process-stages": {
      readStages: async () => stages,
      columnToMyin: async (_actor, id, input) => { calls.myin.push({ id, ...input }); return { stage: { version: input.expectedVersion + 1 } }; },
    },
    "./youtube-process": { getYoutubeProject: async (_actor, id) => ({ id }), notify: async (to, reason, id, key) => { calls.notices.push({ to, reason, id, key }); } },
    "./youtube-process-short-recycle": { makeShortFromRecycle: async (_actor, id, input) => { if (fail.has(input.itemId)) throw new Error("title too long"); calls.made.push({ id, ...input }); } },
    "./youtube-ai-jobs": { staffJobRequestSchema: { parse: (value) => value }, requestStaffJob: async (actor, input, gpt, auto) => { calls.requested.push({ ownerId: actor.ownerId, input, gpt, auto }); return { id: "job", status: "active" }; } },
  };
  const compiled = { exports: {} };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: compiled, exports: compiled.exports, require: (name) => modules[name], console: { ...console, error: () => undefined }, process: { env: { OPENAI_API_KEY: "set" } } });
  return { jobs: compiled.exports, calls, after: () => after?.() };
}
const uploaded = (extra = {}) => ({ upload: { data: { run: { status: "done", follow: true, videoUrl: "https://www.youtube.com/watch?v=x" }, ...extra } }, make: { data: { thumbs: { A: { path: "t.png" } } } },
  column: { version: 3, data: { items: [{ id: "c1", html: '<figure class="ph hero" data-slot="hero"></figure><figure class="ph video" data-slot="video"></figure><figure class="ph" data-slot="1"></figure>', fills: { 1: { url: "https://a/b.jpg" } } }] } },
  shortTopics: { data: { recycle: { items: [{ id: "a" }, { id: "b" }, { id: "c" }] } } } });

test("after the upload the 칼럼 goes out and public by itself, unless a place stays empty or it was already sent", async () => {
  const ok = loadFollow({ stages: uploaded() });
  await ok.jobs.publishColumnAfterUpload("p1", owner);
  assert.deepEqual(ok.calls.myin.map((call) => [call.action, call.expectedVersion]), [["send", 3], ["publish", 4]], "sent as a draft, then made public on the version the send left");
  assert.deepEqual(JSON.parse(JSON.stringify(ok.calls.notices.map((notice) => [notice.to, notice.reason]))), [[["owner"], "ai_result"]], "the PD hears it once");

  const empty = uploaded(); empty.column.data.items[0].fills = {};
  const held = loadFollow({ stages: empty });
  await held.jobs.publishColumnAfterUpload("p1", owner);
  assert.equal(held.calls.myin.length, 0, "an empty image place keeps the 칼럼 back");
  assert.equal(held.calls.notices.length, 1, "and the PD is told");

  const sent = uploaded(); sent.column.data.items[0].myin = { status: "draft" };
  const before = uploaded(); before.upload.data.run.follow = undefined;
  for (const stages of [sent, before]) {
    const none = loadFollow({ stages });
    await none.jobs.publishColumnAfterUpload("p1", owner);
    assert.equal(none.calls.myin.length + none.calls.notices.length, 0, "a 칼럼 already sent, or an upload without 저절로, is left alone");
  }
});

test("after the upload the picked stretches become 숏폼 that start their voice; a refused one stays, nothing is made twice", async () => {
  const run = loadFollow({ stages: uploaded(), fail: new Set(["b"]) });
  await run.jobs.makeRecycleAfterUpload("p1", owner);
  assert.deepEqual(run.calls.made.map((call) => [call.itemId, call.start]), [["a", true], ["c", true]]);
  const again = uploaded(); again.shortTopics.data.recycle.items[0].made = { projectId: "s1" };
  const once = loadFollow({ stages: again });
  await once.jobs.makeRecycleAfterUpload("p1", owner);
  assert.equal(once.calls.made.length, 0, "the PD already made one: the rest are theirs");
});

test("the upload starts on GPT only what is missing, as the PD's own auto job", async () => {
  const fresh = uploaded(); fresh.shortTopics.data.recycle = undefined;
  const run = loadFollow({ stages: fresh });
  run.jobs.scheduleUploadFollowUps({ id: "p1", assigneeId: "pd" }, owner);
  await run.after();
  assert.deepEqual(run.calls.requested.map((call) => [call.ownerId, call.input.task, call.gpt.tier, call.auto]), [["pd", "short-recycle", "saving", true]], "the 칼럼 already there is not written again");
  assert.deepEqual(run.calls.myin.map((call) => call.action), ["send", "publish"]);
});
