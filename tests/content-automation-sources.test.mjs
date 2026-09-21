import assert from 'node:assert/strict';
import test from 'node:test';
import { automationSourcesFor, selectedAutomationSource } from '../lib/content-automation-sources.ts';
const topic = (id, metadata = {}) => ({ id, record_type: 'content_topic', archived_at: null, metadata });
test('linked unstarted topic is visible without changing its metadata', () => {
  const linked = topic('linked'); const before = structuredClone(linked);
  const sources = automationSourcesFor([topic('other'), linked, topic('active', { pipelineEnabled: true })], 'linked');
  assert.deepEqual(sources.map(row => row.id), ['linked', 'active']);
  assert.deepEqual(linked, before);
  assert.equal(selectedAutomationSource(sources, 'linked'), linked);
});
test('missing, archived and wrong-type links never fall back to a different topic', () => {
  const sources = automationSourcesFor([topic('active', { automationSource: true }), { ...topic('linked'), archived_at: 'date' }, { ...topic('linked'), record_type: 'content_script' }], 'linked');
  assert.equal(selectedAutomationSource(sources, 'linked'), null);
  assert.equal(selectedAutomationSource(sources, '')?.id, 'active');
  assert.deepEqual(automationSourcesFor([topic('unstarted')], null), []);
});
