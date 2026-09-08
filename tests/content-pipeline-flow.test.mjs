import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';
import * as pipeline from '../lib/content-pipeline.ts';

class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const base = (id, extra = {}) => ({ id, record_type: 'content_topic', title: 'Example', description: 'Brief', source_url: null, parent_id: null, version: 1, metadata: {}, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', archived_at: null, ...extra });
function harness() {
  const rows = [base('source', { metadata: { pipelineEnabled: true, audience: 'Readers', evidence: 'Verified reference', experience: 'Provided example' } })];
  let calls = 0; let fail = false; let pause = null;
  const client = { from() {
    const filters = []; let changes; let start = 0; let end = Infinity;
    const query = { select() { return query; }, eq(key, value) { filters.push((row) => row[key] === value); return query; }, is(key, value) { return query.eq(key, value); }, order() { return query; }, range(a, b) { start = a; end = b; return query; }, update(value) { changes = value; return query; },
      result(single) { const matched = rows.filter((row) => filters.every((predicate) => predicate(row))).slice(start, end + 1); if (changes) for (const row of matched) Object.assign(row, structuredClone(changes), { version: row.version + 1 }); return { data: structuredClone(single ? matched[0] ?? null : matched), error: null }; },
      async maybeSingle() { return query.result(true); }, then(resolve, reject) { return Promise.resolve(query.result(false)).then(resolve, reject); } };
    return query;
  } };
  const generation = { generationSchema: {}, generationProcedureRevision: async () => "rules-v3", executeGeneration: async (_actor, input, key) => {
    calls++; if (pause) await pause; if (fail) throw new ApiError(502, 'FAILED', 'Temporary failure');
    const row = base(`generated-${calls}`, { record_type: input.action === 'script_draft' ? 'content_script' : 'content_package', parent_id: 'source', description: 'Actual generated content', created_at: `2026-09-08T00:00:${String(calls).padStart(2, '0')}Z`, metadata: { packageKind: input.action, generationRequestKey: key } }); rows.push(row); return { queued: false, configured: true, records: [structuredClone(row)] };
  } };
  const compiled = { exports: {} };
  const source = readFileSync(new URL('../lib/server/content-pipeline.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: compiled, exports: compiled.exports, Date, console, require(name) { if (name === 'node:crypto') return crypto; if (name === '@/lib/http') return { ApiError }; if (name === '@/lib/content-pipeline') return pipeline; if (name === './content-generation') return generation; throw Error(name); } });
  return { api: compiled.exports, rows, actor: { id: 'human', supabase: client }, calls: () => calls, fail(value) { fail = value; }, pause(value) { pause = value; } };
}
const input = (action) => ({ sourceId: 'source', action, count: 5 });
test('pipeline stops at each gate and reuses successful generation', async () => {
  const h = harness();
  await assert.rejects(h.api.runPipelineGeneration(h.actor, input('script_draft')), (error) => error.code === 'PIPELINE_APPROVAL_REQUIRED');
  await h.api.runPipelineGeneration(h.actor, input('topic_plan'));
  let state = await h.api.readPipeline(h.actor, 'source');
  await h.api.reviewPipeline(h.actor, 'source', 1, state.signatures[0], true, 'Checked reference');
  await h.api.runPipelineGeneration(h.actor, input('script_draft'));
  const repeated = await h.api.runPipelineGeneration(h.actor, input('script_draft'));
  assert.equal(repeated.reused, true); assert.equal(h.calls(), 2);
  await assert.rejects(h.api.runPipelineGeneration(h.actor, input('youtube_kit')), (error) => error.code === 'PIPELINE_APPROVAL_REQUIRED');
  await h.api.runPipelineGeneration(h.actor, input('title_package'));
  state = await h.api.readPipeline(h.actor, 'source');
  await h.api.reviewPipeline(h.actor, 'source', 2, state.signatures[1], true, 'Checked script');
  const script = h.rows.find((row) => row.record_type === 'content_script'); script.version++;
  state = await h.api.readPipeline(h.actor, 'source'); assert.equal(state.approved[0], true); assert.equal(state.approved[1], false);
  await assert.rejects(h.api.runPipelineGeneration(h.actor, input('youtube_kit')), (error) => error.code === 'PIPELINE_APPROVAL_REQUIRED');
});
test('pipeline retains failures, allows retry, and rejects concurrent runs', async () => {
  const h = harness(); h.fail(true);
  await assert.rejects(h.api.runPipelineGeneration(h.actor, input('topic_plan')));
  assert.equal(h.rows[0].metadata.pipelineRuns[0].state, 'failed');
  h.fail(false); await h.api.runPipelineGeneration(h.actor, input('topic_plan')); assert.equal(h.calls(), 2);
  h.rows[0].metadata.evidence = 'Updated verified reference';
  let resume; h.pause(new Promise((resolve) => { resume = resolve; }));
  const pending = h.api.runPipelineGeneration(h.actor, input('topic_plan'));
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(h.api.runPipelineGeneration(h.actor, input('topic_plan')), (error) => error.code === 'PIPELINE_RUNNING');
  resume(); await pending; assert.equal(h.calls(), 3);
});
test('pipeline rejects stale reviews and missing facts without invoking AI', async () => {
  const h = harness(); h.rows[0].metadata.experience = '';
  await assert.rejects(h.api.runPipelineGeneration(h.actor, input('topic_plan')), (error) => error.code === 'PIPELINE_NEEDS_INPUT'); assert.equal(h.calls(), 0);
  h.rows[0].metadata.experience = 'Provided example'; await h.api.runPipelineGeneration(h.actor, input('topic_plan'));
  const state = await h.api.readPipeline(h.actor, 'source'); h.rows[0].metadata.evidence = 'Changed source';
  await assert.rejects(h.api.reviewPipeline(h.actor, 'source', 1, state.signatures[0], true, ''), (error) => error.code === 'PIPELINE_CHANGED');
});
