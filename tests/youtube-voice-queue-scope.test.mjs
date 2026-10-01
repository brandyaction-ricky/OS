import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { z } from 'zod';

function harness(render = false) {
  const selected = [];
  const rows = ['older-other-job', 'requested-job'].map(id => ({ id, record_type: 'ai_job', kind: 'voice', status: render ? 'done' : 'backlog', stage: 'voice_ready', archived_at: null }));
  const service = { from() {
    const filters = [];
    const q = { select() { return q; }, eq(k, v) { filters.push(row => row[k.replace('metadata->>', '')] === v); return q; }, in(k, vs) { filters.push(row => vs.includes(row[k])); return q; }, is(k, v) { return q.eq(k, v); }, order() { return q; }, limit() { return Promise.resolve({ data: rows.filter(row => filters.every(f => f(row))), error: null }); } };
    return q;
  } };
  const compiled = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(render ? '../lib/server/youtube-render-run.ts' : '../lib/server/youtube-voice-worker.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module: compiled, exports: compiled.exports, Date,
    require(name) {
      if (name === 'zod') return { z };
      if (name === '@/lib/supabase/server') return { createServiceSupabase: () => service };
      if (name === './youtube-voice-run') return { YOUTUBE_VOICE_RUN_KIND: 'voice', parseVoiceRun: row => { selected.push(row.id); return { lease: { expiresAt: new Date(Date.now() + 60000).toISOString() } }; } };
      return {};
    },
  });
  return { selected, run: render ? target => compiled.exports.claimYoutubeRender(service, target) : compiled.exports.processYoutubeVoiceQueue };
}
test('targeted worker never selects an older unrelated job', async () => {
  const h = harness(); await h.run('requested-job'); assert.deepEqual(h.selected, ['requested-job']);
});
test('missing target does not fall back to the shared queue', async () => {
  const h = harness(); const result = await h.run('missing'); assert.equal(result.processed, false); assert.deepEqual(h.selected, []);
});
test('scheduler retains default shared queue selection', async () => {
  const h = harness(); await h.run(); assert.deepEqual(h.selected, ['older-other-job', 'requested-job']);
});

test('targeted render selects only the requested voice job', async () => {
  const h = harness(true); await h.run('requested-job'); assert.deepEqual(h.selected, ['requested-job']);
});
test('render does not fall back when the requested voice job is absent', async () => {
  const h = harness(true); const result = await h.run('missing'); assert.equal(result.idle, true); assert.deepEqual(h.selected, []);
});
