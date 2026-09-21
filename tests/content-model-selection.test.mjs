import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import { selectedPackaging } from '../lib/content-selected-packaging.ts';
import { usesShootingPlan } from '../lib/content-pipeline.ts';

class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
function moduleAt(path, imports, globals = {}) {
  const compiled = { exports: {} };
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module: compiled, exports: compiled.exports, ...globals,
    require(name) { if (name in imports) return imports[name]; throw Error(name); },
  });
  return compiled.exports;
}
const pack = (extra = {}) => ({ id: 'package', parent_id: 'source', record_type: 'content_package', archived_at: null, created_at: '2026-09-21T00:00:00Z', metadata: { packageKind: 'title_package', result: { titles: [{ text: 'Selected title', picked: true }, { text: 'DO_NOT_SEND_TITLE', picked: false }], copies: [{ text: 'Selected copy', picked: true }], designPrompts: ['DO_NOT_SEND_DESIGN'] } }, ...extra });

test('packaging projection sends selected text only and refuses incomplete latest package', () => {
  assert.deepEqual(selectedPackaging([pack()], 'source'), { title: 'Selected title', thumbnailCopies: ['Selected copy'] });
  for (const override of [{ parent_id: 'other' }, { archived_at: 'date' }, { record_type: 'content_script' }]) assert.equal(selectedPackaging([pack(override)], 'source'), null);
  const latest = pack({ id: 'new', created_at: '2026-09-22T00:00:00Z', metadata: { packageKind: 'title_package', result: {} } });
  assert.equal(selectedPackaging([pack(), latest], 'source'), null);
  const invalid = pack(); invalid.metadata.result.titles.push({ text: 'Second selected title', picked: true });
  assert.equal(selectedPackaging([invalid], 'source'), null);
  invalid.metadata.result.titles = [{ text: ' '.repeat(5), picked: true }];
  assert.equal(selectedPackaging([invalid], 'source'), null);
});

function generationHarness({ packages = [pack()], board = false, readError = false } = {}) {
  const prompts = [], writes = [];
  const source = { id: 'source', title: 'Synthetic topic', description: 'Synthetic brief', metadata: { planningHandoff: { productionFormat: board ? 'board' : 'script' } } };
  const actor = { id: 'tester', supabase: { from(table) {
    const filters = {}; let insertion;
    const query = { select() { return query; }, eq(k, v) { filters[k] = v; return query; }, neq() { return query; }, is() { return query; }, order() { return query; }, range() { return query; }, or() { return query; }, limit() { return query; },
      insert(value) { insertion = value; writes.push(value); return query; },
      async single() { return { data: { id: 'result', ...insertion }, error: null }; },
      async maybeSingle() { return { data: source, error: null }; },
      then(resolve, reject) { const isPackages = filters.record_type === 'content_package'; return Promise.resolve({ data: table === 'os_documents' ? [{ id: 'rule', title: 'Synthetic procedure', status: 'canonical', content_md: 'Synthetic rule' }] : isPackages ? packages : [], error: isPackages && readError ? { message: 'private error' } : null }).then(resolve, reject); },
    }; return query;
  } } };
  const api = moduleAt('../lib/server/content-generation.ts', {
    zod: { z }, '@/lib/http': { ApiError }, '@/lib/structure-borrow': { structureBorrowGuidance: () => '' },
    '@/lib/content-input': { contentSourceText: () => '', parseTimedTranscript: () => [], resolveChannelProcedures: () => [], BUNDLED_CHANNEL_PROCEDURE_VERSION: 'test' },
    '@/lib/content-safety': { PUBLIC_COPY_GUIDANCE: 'test', sanitizePublicCopyValue: value => value },
    '@/lib/content-pipeline': { usesShootingPlan }, '@/lib/content-selected-packaging': { selectedPackaging },
    './content-model': { generateContentText: async request => { prompts.push(request); return JSON.stringify({ title: 'Draft', script: 'Synthetic script' }); } },
  }, { process: { env: { ANTHROPIC_API_KEY: 'synthetic-only' } } });
  return { run: () => api.executeGeneration(actor, { sourceId: 'source', action: 'script_draft', count: 5 }), prompts, writes };
}

test('direct script generation includes only selected packaging in the model request', async () => {
  const h = generationHarness(); await h.run();
  assert.equal(h.prompts.length, 1);
  assert.match(h.prompts[0].prompt, /Selected title/);
  assert.match(h.prompts[0].prompt, /Selected copy/);
  assert.doesNotMatch(h.prompts[0].prompt, /DO_NOT_SEND/);
  assert.equal(h.writes.length, 1);
});

test('missing packaging, read failure and board mode stop before model call or save', async () => {
  for (const [options, code] of [[{ packages: [] }, 'PACKAGING_SELECTION_REQUIRED'], [{ readError: true }, 'PACKAGING_READ_FAILED'], [{ board: true }, 'SHOOTING_PLAN_MODE']]) {
    const h = generationHarness(options);
    await assert.rejects(h.run(), error => error.code === code);
    assert.equal(h.prompts.length, 0); assert.equal(h.writes.length, 0);
  }
});

test('Claude adapter preserves structured output and has no provider fallback', async () => {
  const requests = [];
  let response = { ok: true, json: async () => ({ content: [{ type: 'text', text: '{"ok":true}' }] }) };
  const api = moduleAt('../lib/server/content-model.ts', { '@/lib/http': { ApiError } }, {
    process: { env: { ANTHROPIC_API_KEY: 'synthetic-only' } }, AbortSignal,
    fetch: async (url, options) => { requests.push({ url, options }); return response; },
  });
  const request = { prompt: 'Synthetic prompt', model: 'test-model', jsonSchema: { type: 'object' }, maxTokens: 100 };
  assert.equal(await api.generateContentText(request), '{"ok":true}');
  assert.equal(requests[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(JSON.parse(requests[0].options.body).output_config.format.type, 'json_schema');
  response = { ok: false, json: async () => ({ error: 'private provider response' }) };
  await assert.rejects(api.generateContentText(request), error => error.code === 'CLAUDE_GENERATION_FAILED' && !error.message.includes('private'));
  assert.equal(requests.length, 2);
  response = { ok: true, json: async () => ({ stop_reason: 'max_tokens' }) };
  await assert.rejects(api.generateContentText(request), error => error.code === 'CLAUDE_OUTPUT_TRUNCATED');
});
