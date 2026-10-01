import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';
import * as pipeline from '../lib/content-pipeline.ts';
import * as scriptReview from '../lib/content-script-review.ts';
import * as writingWorkflow from '../lib/content-writing-workflow.ts';

class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const base = (id, extra = {}) => ({ id, record_type: 'content_topic', title: 'Example', description: 'Brief', source_url: null, parent_id: null, version: 1, metadata: {}, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', archived_at: null, ...extra });
function harness() {
  const appeal = base('appeal', { record_type: 'content_package', parent_id: 'source', metadata: { packageKind: 'appeal_candidates', result: { candidates: [{ text: 'Approved appeal', decision: 'approved', decidedAt: '2026-09-01T00:00:00Z' }] } } });
  const rows = [base('source', { metadata: { pipelineEnabled: true, audience: 'Readers', evidence: 'Verified reference', experience: 'Provided example', researchBrief: { youtubeUrls: ['https://youtube.com/watch?v=verified'], topicFit: 'Direct topic fit', audienceFit: 'Core audience fit', queryIntentFit: 'Query intent fit', limitations: 'Instagram metrics unavailable', verifiedAt: '2026-09-01T00:00:00Z', approvedAppeals: [{ text: 'Approved appeal' }], appealPackageId: appeal.id, appealPackageVersion: appeal.version } } }), appeal];
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
    const result = input.action === 'topic_plan'
      ? { candidates: [{ title: 'Selected direction', narrative: 'Promise', picked: false }] }
      : input.action === 'title_package'
        ? { titles: [{ text: 'Final title', picked: true }], copies: [{ text: 'Final copy', picked: true }] }
        : {};
    const row = base(`generated-${calls}`, { record_type: input.action === 'script_draft' ? 'content_script' : 'content_package', parent_id: 'source', description: 'Actual generated content', created_at: `2026-09-08T00:00:${String(calls).padStart(2, '0')}Z`, metadata: { packageKind: input.action, generationRequestKey: key, result } }); rows.push(row); return { queued: false, configured: true, records: [structuredClone(row)] };
  } };
  const compiled = { exports: {} };
  const source = readFileSync(new URL('../lib/server/content-pipeline.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: compiled, exports: compiled.exports, Date, console, require(name) { if (name === 'node:crypto') return crypto; if (name === '@/lib/http') return { ApiError }; if (name === '@/lib/content-pipeline') return pipeline; if (name === '@/lib/content-script-review') return scriptReview; if (name === '@/lib/content-writing-workflow') return writingWorkflow; if (name === './content-generation') return generation; throw Error(name); } });
  return { api: compiled.exports, rows, actor: { id: 'human', supabase: client }, calls: () => calls, fail(value) { fail = value; }, pause(value) { pause = value; } };
}
const input = (action) => ({ sourceId: 'source', action, count: 5 });
function choosePlan(h) {
  const plan = h.rows.findLast((row) => row.metadata.packageKind === 'topic_plan');
  plan.metadata.result.candidates[0].picked = true; plan.version++;
  h.rows[0].metadata.pickedCandidate = structuredClone(plan.metadata.result.candidates[0]);
  h.rows[0].metadata.planningPackageId = plan.id; h.rows[0].metadata.planningPackageVersion = plan.version;
  return plan;
}
async function approveWritingWorkflow(h) {
  let state = await h.api.readPipeline(h.actor, 'source');
  await h.api.reviewWritingPreparation(h.actor, 'source', state.source.version, 'package', true, 'Current package checked');
  for (const [step, content] of [['materials', 'Verified sources, facts, and limitations'], ['axis', 'One clear promise and exclusions'], ['design', 'Opening, evidence, interpretation, and close']]) {
    state = await h.api.readPipeline(h.actor, 'source');
    await h.api.saveWritingPreparation(h.actor, 'source', state.source.version, step, content);
    state = await h.api.readPipeline(h.actor, 'source');
    await h.api.reviewWritingPreparation(h.actor, 'source', state.source.version, step, true, `${step} checked`);
  }
}
async function approveScriptReview(h) {
  for (const [step, content] of [['claim', 'One clear claim without overstatement'], ['evidence', 'Every claim is tied to a checked source or case'], ['audience', 'The script answers the selected audience scene'], ['expression', 'Plain language, no repetition, brand-safe wording']]) {
    let state = await h.api.readPipeline(h.actor, 'source');
    await h.api.saveScriptReview(h.actor, 'source', state.source.version, step, content);
    state = await h.api.readPipeline(h.actor, 'source');
    await h.api.reviewScript(h.actor, 'source', state.source.version, step, true, `${step} checked`);
  }
}
test('pipeline stops at each gate and reuses successful generation', async () => {
  const h = harness();
  await assert.rejects(h.api.runPipelineGeneration(h.actor, input('script_draft')), (error) => error.code === 'PIPELINE_APPROVAL_REQUIRED');
  await h.api.runPipelineGeneration(h.actor, input('topic_plan'));
  choosePlan(h);
  let state = await h.api.readPipeline(h.actor, 'source');
  await h.api.reviewPipeline(h.actor, 'source', 1, state.signatures[0], true, 'Checked reference');
  await assert.rejects(h.api.runPipelineGeneration(h.actor, input('script_draft')), (error) => error.code === 'PIPELINE_NEEDS_INPUT');
  await h.api.runPipelineGeneration(h.actor, input('title_package'));
  await assert.rejects(h.api.runPipelineGeneration(h.actor, input('script_draft')), (error) => error.code === 'WRITING_WORKFLOW_REQUIRED');
  await approveWritingWorkflow(h);
  await h.api.runPipelineGeneration(h.actor, input('script_draft'));
  const repeated = await h.api.runPipelineGeneration(h.actor, input('script_draft'));
  assert.equal(repeated.reused, true); assert.equal(h.calls(), 3);
  const packaging = h.rows.find((row) => row.metadata.packageKind === 'title_package');
  packaging.metadata.result.titles[0].text = 'Changed final title'; packaging.version++;
  await assert.rejects(h.api.runPipelineGeneration(h.actor, input('script_draft')), (error) => error.code === 'WRITING_WORKFLOW_REQUIRED');
  await approveWritingWorkflow(h);
  const regenerated = await h.api.runPipelineGeneration(h.actor, input('script_draft'));
  assert.equal(regenerated.reused, undefined); assert.equal(h.calls(), 4);
  await assert.rejects(h.api.runPipelineGeneration(h.actor, input('youtube_kit')), (error) => error.code === 'PIPELINE_APPROVAL_REQUIRED');
  state = await h.api.readPipeline(h.actor, 'source');
  assert.equal(state.scriptReview.ready, false);
  assert.ok(state.missing[1].includes('주장 검수'));
  await approveScriptReview(h);
  state = await h.api.readPipeline(h.actor, 'source');
  assert.equal(state.scriptReview.ready, true);
  await h.api.reviewPipeline(h.actor, 'source', 2, state.signatures[1], true, 'Checked script');
  const script = h.rows.findLast((row) => row.record_type === 'content_script'); script.version++;
  state = await h.api.readPipeline(h.actor, 'source'); assert.equal(state.approved[0], true); assert.equal(state.approved[1], false); assert.equal(state.scriptReview.ready, false);
  await assert.rejects(h.api.runPipelineGeneration(h.actor, input('youtube_kit')), (error) => error.code === 'PIPELINE_APPROVAL_REQUIRED');
});

test('writing preparation is sequential and a package change invalidates downstream approvals', async () => {
  const h = harness();
  await h.api.runPipelineGeneration(h.actor, input('topic_plan')); choosePlan(h);
  let state = await h.api.readPipeline(h.actor, 'source');
  await h.api.reviewPipeline(h.actor, 'source', 1, state.signatures[0], true, 'Planning checked');
  await h.api.runPipelineGeneration(h.actor, input('title_package'));
  state = await h.api.readPipeline(h.actor, 'source');
  await assert.rejects(h.api.saveWritingPreparation(h.actor, 'source', state.source.version, 'axis', 'Too early'), (error) => error.code === 'WRITING_STEP_BLOCKED');
  await approveWritingWorkflow(h);
  state = await h.api.readPipeline(h.actor, 'source');
  assert.equal(state.writing.ready, true);
  assert.deepEqual(state.writing.steps.map((step) => step.approved), [true, true, true, true]);
  const originalEvidence = h.rows[0].metadata.evidence;
  h.rows[0].metadata.evidence = 'Changed planning evidence';
  state = await h.api.readPipeline(h.actor, 'source');
  assert.equal(state.approved[0], false);
  assert.equal(state.writing.ready, false);
  h.rows[0].metadata.evidence = originalEvidence;
  const packaging = h.rows.findLast((row) => row.metadata.packageKind === 'title_package');
  packaging.metadata.result.titles[0].text = 'Changed package title'; packaging.version++;
  state = await h.api.readPipeline(h.actor, 'source');
  assert.equal(state.writing.ready, false);
  assert.equal(state.writing.steps[0].approved, false);
  assert.equal(state.writing.steps[1].content, 'Verified sources, facts, and limitations');
  await assert.rejects(h.api.runPipelineGeneration(h.actor, input('script_draft')), (error) => error.code === 'WRITING_WORKFLOW_REQUIRED');
});
test('script review keeps notes but invalidates approvals when the script changes', async () => {
  const h = harness();
  await h.api.runPipelineGeneration(h.actor, input('topic_plan')); choosePlan(h);
  let state = await h.api.readPipeline(h.actor, 'source');
  await h.api.reviewPipeline(h.actor, 'source', 1, state.signatures[0], true, 'Planning checked');
  await h.api.runPipelineGeneration(h.actor, input('title_package'));
  await approveWritingWorkflow(h);
  await h.api.runPipelineGeneration(h.actor, input('script_draft'));
  await assert.rejects(h.api.reviewScript(h.actor, 'source', h.rows[0].version, 'claim', true, ''), (error) => error.code === 'SCRIPT_REVIEW_BLOCKED');
  await approveScriptReview(h);
  state = await h.api.readPipeline(h.actor, 'source');
  assert.equal(state.scriptReview.ready, true);
  const script = h.rows.findLast((row) => row.record_type === 'content_script'); script.description = 'Revised actual script'; script.version++;
  state = await h.api.readPipeline(h.actor, 'source');
  assert.equal(state.scriptReview.ready, false);
  assert.equal(state.scriptReview.steps[0].content, 'One clear claim without overstatement');
  assert.match(state.scriptReview.blocker, /원고가 변경/);
  await h.api.saveScriptReview(h.actor, 'source', state.source.version, 'claim', state.scriptReview.steps[0].content);
  state = await h.api.readPipeline(h.actor, 'source');
  assert.equal(state.scriptReview.currentScript, true);
  assert.equal(state.scriptReview.steps.every((step) => !step.approved), true);
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
  h.rows[0].metadata.experience = 'Provided example'; await h.api.runPipelineGeneration(h.actor, input('topic_plan')); choosePlan(h);
  const state = await h.api.readPipeline(h.actor, 'source'); h.rows[0].metadata.evidence = 'Changed source';
  await assert.rejects(h.api.reviewPipeline(h.actor, 'source', 1, state.signatures[0], true, ''), (error) => error.code === 'PIPELINE_CHANGED');
});
test('changing the approved appeal set invalidates the first pipeline approval', async () => {
  const h = harness();
  await h.api.runPipelineGeneration(h.actor, input('topic_plan'));
  choosePlan(h);
  let state = await h.api.readPipeline(h.actor, 'source');
  await h.api.reviewPipeline(h.actor, 'source', 1, state.signatures[0], true, 'Appeal and references checked');
  h.rows.find((row) => row.id === 'appeal').version++;
  state = await h.api.readPipeline(h.actor, 'source');
  assert.equal(state.approved[0], false);
  await assert.rejects(h.api.runPipelineGeneration(h.actor, input('script_draft')), (error) => error.code === 'PIPELINE_APPROVAL_REQUIRED');
});

test('planning and packaging selections require one exact current choice', () => {
  const h = harness();
  const plan = base('plan', { record_type: 'content_package', parent_id: 'source', version: 3, metadata: { packageKind: 'topic_plan', result: { candidates: [{ title: 'A', picked: true }, { title: 'B', picked: false }] } } });
  const source = h.rows[0];
  source.metadata.pickedCandidate = structuredClone(plan.metadata.result.candidates[0]);
  source.metadata.planningPackageId = plan.id; source.metadata.planningPackageVersion = 3;
  assert.equal(pipeline.planningSelectionReady(source, plan), true);
  assert.equal(pipeline.planningSelectionReady(source, { ...plan, version: 4 }), false);
  const pack = base('pack', { record_type: 'content_package', metadata: { result: { titles: [{ picked: true }], copies: [{ picked: true }] } } });
  assert.equal(pipeline.pickedPackaging(pack).ready, true);
  pack.metadata.result.titles.push({ picked: true });
  assert.equal(pipeline.pickedPackaging(pack).ready, false);
});
