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
  assert.deepEqual([...gptDraft.GPT_DRAFT_TASKS], ["kit", "column", "short-topics", "short-script", "card"]);
  assert.deepEqual([...gptDraft.GPT_AUTO_TASKS], ["kit", "column", "short-topics"], "숏폼 대본 waits for the PD's topic and formula");
  assert.equal(gptDraft.isGptTask("script"), false, "the 원고 stays with the staff AI (원고 공정 정본 §12-1)");
  assert.equal(gptDraft.draftTag("유쓰", "gpt-6-astra"), "GPT 초안 · GPT-6 Astra");
  assert.equal(gptDraft.draftTag("유쓰", "claude-opus-5-5"), "AI 초안 · 유쓰");
});
