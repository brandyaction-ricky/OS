import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';
import { z } from 'zod';
import * as pipeline from '../lib/content-pipeline.ts';
import * as contentInput from '../lib/content-input.ts';
import * as safety from '../lib/content-safety.ts';
import { selectedPackaging } from '../lib/content-selected-packaging.ts';

// Local-only synthetic fixtures. No credentials, network, DEV seed or human approval.
class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
function load(path, imports) {
  const compiled = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module: compiled, exports: compiled.exports, Date, process: { env: { ANTHROPIC_API_KEY: 'mock-only' } }, require(name) { if (name in imports) return imports[name]; throw Error(`Unexpected dependency: ${name}`); } });
  return compiled.exports;
}
const record = (id, extra = {}) => ({ id, title: '[QA] Synthetic fixture', record_type: 'content_package', description: 'Synthetic material', version: 1, parent_id: 'source', archived_at: null, created_at: '2026-09-01T00:00:00Z', metadata: {}, ...extra });
const srt = '1\n00:00:00,000 --> 00:00:04,000\nSynthetic recorded speech\n\n2\n00:00:04,000 --> 00:00:08,000\nSynthetic closing';
function harness(action) {
  const source = record('source', { record_type: 'content_topic', parent_id: null, metadata: { pipelineEnabled: true, audience: 'Synthetic audience', evidence: 'No real claims', experience: 'No real experience', planningHandoff: { productionFormat: 'board' }, productionPreparation: { kind: 'shooting_plan', design: 'DO_NOT_SEND_DESIGN', shootingPlan: 'DO_NOT_SEND_PLAN' }, script: 'DO_NOT_SEND_OLD_SCRIPT' } });
  const rows = [source, record('research', { metadata: { packageKind: 'topic_plan' } }), record('packaging', { metadata: { packageKind: 'title_package', result: { titles: [{ text: '[QA] Synthetic title', picked: false }], copies: [{ text: '[QA] Synthetic copy', picked: false }] } } }), record('legacy-script', { record_type: 'content_script', status: 'ready', description: 'DO_NOT_SEND_LEGACY_SCRIPT' })];
  const documents = [{ id: 'rule', title: 'Synthetic local rule', current_version: 1, status: 'canonical', content_md: 'Synthetic local rule, not company policy', source_ref: null }];
  const prompts = [];
  const actor = { id: 'synthetic-reviewer', team: 'QA', supabase: { from(table) {
    const filters = []; let changes, insertion; let start = 0, end = Infinity;
    const field = (row, key) => key.includes('->>') ? row[key.split('->>')[0]]?.[key.split('->>')[1]] : row[key];
    const query = { select() { return query; }, eq(k, v) { filters.push(row => field(row, k) === v); return query; }, neq(k, v) { filters.push(row => field(row, k) !== v); return query; }, is(k, v) { return query.eq(k, v); }, or() { return query; }, order() { return query; }, range(a, b) { start = a; end = b; return query; }, update(value) { changes = value; return query; }, insert(value) { insertion = value; return query; },
      result(single) {
        let matched;
        if (insertion) { matched = (Array.isArray(insertion) ? insertion : [insertion]).map((value, index) => record(`generated-${rows.length}-${index}`, value)); rows.push(...matched); insertion = undefined; }
        else matched = (table === 'os_documents' ? documents : rows).filter(row => filters.every(predicate => predicate(row))).slice(start, end + 1);
        if (changes) { for (const row of matched) Object.assign(row, structuredClone(changes), { version: row.version + 1 }); changes = undefined; }
        return { data: structuredClone(single ? matched[0] ?? null : matched), error: null };
      }, async maybeSingle() { return query.result(true); }, async single() { return query.result(true); }, then(resolve, reject) { return Promise.resolve(query.result(false)).then(resolve, reject); } };
    return query;
  } } };
  const generation = load('../lib/server/content-generation.ts', { zod: { z }, '@/lib/http': { ApiError }, '@/lib/structure-borrow': { structureBorrowGuidance: () => '' }, '@/lib/content-input': contentInput, '@/lib/content-safety': safety, '@/lib/content-pipeline': pipeline, '@/lib/content-selected-packaging': { selectedPackaging }, './content-model': { generateContentText: async request => {
    prompts.push(request.prompt);
    return JSON.stringify(action === 'shorts_proposal' ? { clips: [{ title: '[QA] Clip', hook: 'Synthetic recorded speech', start: 0, end: 4, reason: 'Synthetic' }] } : action === 'derivatives' ? { items: [{ platform: 'threads', title: '[QA] Post', body: 'Synthetic recorded speech' }] } : { title: '[QA] Kit', summary: 'Synthetic recorded speech', description: 'Synthetic recorded speech', chapters: [], checklist: [] });
  } } });
  const api = load('../lib/server/content-pipeline.ts', { 'node:crypto': crypto, '@/lib/http': { ApiError }, '@/lib/content-pipeline': pipeline, '@/lib/content-input': contentInput, './content-generation': generation });
  return { source, rows, prompts, actor, api, input: { sourceId: 'source', action, count: 1, platforms: ['threads'] } };
}

for (const action of ['youtube_kit', 'shorts_proposal', 'derivatives']) test(`approved board flow: ${action} uses transcript, persists and invalidates cache`, async () => {
  const h = harness(action);
  let state = await h.api.readPipeline(h.actor, 'source');
  await assert.rejects(h.api.reviewPipeline(h.actor, 'source', 1, state.signatures[0], true, 'Synthetic QA only'), error => error.code === 'PIPELINE_NEEDS_INPUT');
  const result = h.rows.find(row => row.id === 'packaging').metadata.result;
  result.titles[0].picked = true; result.copies[0].picked = true;
  for (const gate of [1, 2]) {
    state = await h.api.readPipeline(h.actor, 'source');
    await h.api.reviewPipeline(h.actor, 'source', gate, state.signatures[gate - 1], true, 'Synthetic QA only; not human acceptance');
  }
  await assert.rejects(h.api.runPipelineGeneration(h.actor, h.input), error => error.code === 'CONTENT_TRANSCRIPT_REQUIRED');
  assert.equal(h.prompts.length, 0);
  assert.equal(h.rows.length, 4);
  assert.equal(h.source.metadata.pipelineRuns, undefined);
  h.source.metadata.transcriptSrt = srt;
  const generated = await h.api.runPipelineGeneration(h.actor, h.input);
  assert.equal(generated.records.length, 1);
  assert.equal(h.source.metadata.pipelineRuns.at(-1).state, 'succeeded');
  assert.match(h.prompts[0], /Synthetic recorded speech/);
  assert.doesNotMatch(h.prompts[0], /DO_NOT_SEND/);
  assert.equal((await h.api.runPipelineGeneration(h.actor, h.input)).reused, true);
  assert.equal(h.prompts.length, 1);
  const signature = (await h.api.readPipeline(h.actor, 'source')).signatures[2];
  h.source.metadata.transcriptSrt = srt.replace('Synthetic closing', 'Changed synthetic closing');
  state = await h.api.readPipeline(h.actor, 'source');
  assert.equal(state.approved[1], true);
  assert.notEqual(state.signatures[2], signature);
  await h.api.runPipelineGeneration(h.actor, h.input);
  assert.equal(h.prompts.length, 2);
  assert.equal(h.rows.find(row => row.id === 'legacy-script').description, 'DO_NOT_SEND_LEGACY_SCRIPT');
});
