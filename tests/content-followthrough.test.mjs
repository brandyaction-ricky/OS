import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleYoutubeKit, contentSourceText, parseTimedTranscript, selectChannelProcedures, timestampSeconds, validateClipRanges } from '../lib/content-input.ts';
import { dedupeMetricSnapshots, metricValue, summarizeMetrics, fixedWeek } from '../lib/content-metrics.ts';
import { buildKnowledgeGraph, resolveWikiLink } from '../lib/knowledge-links.ts';
import { outlierBaseline } from '../lib/youtube-outliers.ts';
import { protectedPipelineChange } from '../lib/content-pipeline.ts';
import { buildHomeRevenueView } from '../lib/home-dashboard.ts';

const record = (extra = {}) => ({ id: crypto.randomUUID(), record_type: 'content_metric', metadata: {}, metric_current: null, title: 'Example', description: '', brand: '', status: 'review', version: 1, starts_at: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', archived_at: null, ...extra });
const srt = '1\n00:00:00,000 --> 00:00:10,000\nOpening\n\n2\n00:00:10,000 --> 00:00:25,000\nAn example\n\n3\n00:00:25,000 --> 00:00:45,000\nClosing';
test('SRT and VTT keep actual timing and reject malformed ranges', () => {
  const cues = parseTimedTranscript(srt);
  assert.equal(cues.length, 3); assert.equal(cues[2].end, 45);
  assert.equal(parseTimedTranscript('WEBVTT\n\n00:01.500 --> 00:04.000 align:start\n<b>Hello</b>')[0].text, 'Hello');
  assert.equal(timestampSeconds('00:99'), null);
  assert.equal(parseTimedTranscript('1\n00:03 --> 00:01\ninvalid').length, 0);
  assert.equal(validateClipRanges([{ start: 10, end: 45 }], cues), true);
  for (const range of [{ start: -1, end: 20 }, { start: 40, end: 50 }, { start: 4, end: 4 }, { start: '0', end: 20 }]) assert.equal(validateClipRanges([range], cues), false);
});
test('content generation requires an actual script rather than a topic brief', () => {
  assert.equal(contentSourceText(record({ record_type: 'content_topic', description: 'A topic idea' })), '');
  assert.equal(contentSourceText(record({ metadata: { automationSource: true, sourceTextKind: 'brief' }, description: 'An idea' })), '');
  assert.equal(contentSourceText(record({ metadata: { transcriptSrt: srt } })), srt);
  assert.equal(contentSourceText(record(), [{ status: 'review', description: 'Draft' }, { status: 'ready', description: 'Approved' }]), 'Approved');
});
test('channel procedures resolve filename aliases and distinguish approval from absence', () => {
  const docs = [{ id: '1', title: 'Different heading', source_ref: 'Content/쓰레드_쓰는_절차.md', status: 'draft', content_md: 'Procedure' }];
  assert.deepEqual(selectChannelProcedures(docs, ['threads', 'column']).missing, [{ file: '쓰레드_쓰는_절차.md', reason: 'approval', documentId: '1' }, { file: 'SEO칼럼_만드는_절차.md', reason: 'missing', documentId: undefined }]);
  assert.equal(selectChannelProcedures([{ ...docs[0], status: 'canonical' }], ['threads', 'threads']).selected.length, 1);
});
test('YouTube kits include grounded chapters once and do not invent timings', () => {
  const result = assembleYoutubeKit({ description: 'Copy\n00:00 old', tags: ['tag', '#tag', 'other'], chapters: ['00:00 Intro', '00:10 Story', '00:25 End'], checklist: [] }, parseTimedTranscript(srt));
  assert.deepEqual(result.tags, ['tag', 'other']); assert.equal(result.chapterTimingVerified, true);
  assert.equal(result.description.match(/00:00/g).length, 1);
  const invalid = assembleYoutubeKit({ chapters: ['00:00 A', '00:00 B', '00:00 C'] }, parseTimedTranscript(srt));
  assert.deepEqual(invalid.chapters, []); assert.equal(invalid.chapterTimingVerified, false);
  assert.deepEqual(assembleYoutubeKit(result, []).chapters, []);
});
test('wiki resolution follows original filename, aliases, headings and folder disambiguation', () => {
  const documents = [{ id: 'a', title: 'Heading', source_ref: 'One/File.md', folder: 'One', status: 'draft' }, { id: 'b', title: 'Heading', source_ref: 'Two/File.md', folder: 'Two', status: 'draft' }];
  assert.equal(resolveWikiLink('One/File.md#Heading|Label', documents)?.id, 'a');
  assert.equal(resolveWikiLink('File', documents, 'Two')?.id, 'b');
  assert.equal(resolveWikiLink('File', documents), undefined);
  assert.equal(resolveWikiLink('One/File', [{ ...documents[0], status: 'archived' }]), undefined);
  const graph = buildKnowledgeGraph(documents.map((doc) => ({ ...doc, owner_id: 'owner', content_md: doc.id === 'b' ? '[[One/File.md#Top|Alias]]' : '' })));
  assert.deepEqual(graph.edges, [{ source: 'b', target: 'a' }]);
});
test('metric calculation distinguishes unknown and zero and uses exposure weights', () => {
  const a = record({ metadata: { ctr: 10, impressions: 100, retention: 50, views: 20, revenue: 0 } });
  const b = record({ metadata: { ctr: 2, impressions: 900, retention: 25, views: 80 } });
  assert.equal(metricValue(a, 'purchases'), null); assert.equal(metricValue(a, 'revenue'), 0);
  const totals = summarizeMetrics([a, b]); assert.equal(totals.ctr, 2.8); assert.equal(totals.retention, 30); assert.equal(totals.purchases, null); assert.equal(totals.revenue, 0);
  assert.equal(summarizeMetrics([record({ metadata: { ctr: 5 } })]).ctr, null);
});
test('metric snapshots are idempotent and cumulative and daily totals are never summed together', () => {
  const older = record({ metadata: { contentId: 'video', platform: 'youtube', views: 10, measuredAt: '2026-09-01T10:00:00Z' } });
  const newer = record({ metadata: { ...older.metadata, views: 15, measuredAt: '2026-09-01T12:00:00Z' } });
  const cumulative = record({ metadata: { contentId: 'video', platform: 'youtube', metricMode: 'cumulative', views: 500 } });
  assert.deepEqual(dedupeMetricSnapshots([older, newer, cumulative]).map((item) => metricValue(item, 'views')), [15]);
  const latest = record({ metadata: { ...cumulative.metadata, views: 600 }, updated_at: '2026-09-02T00:00:00Z', starts_at: '2026-09-02T00:00:00Z' });
  assert.deepEqual(dedupeMetricSnapshots([cumulative, latest]).map((item) => metricValue(item, 'views')), [600]);
  assert.deepEqual(fixedWeek('2026-08-29'), { start: '2026-08-29', end: '2026-09-04' });
});
test('outliers require 20 comparable same-channel long videos and never use subscriber ratios', () => {
  const now = Date.parse('2026-09-08');
  const target = { id: 'target', channelId: 'channel', title: 'Example', publishedAt: '2026-08-09', views: 500, durationSeconds: 300 };
  const peers = Array.from({ length: 20 }, (_, index) => ({ ...target, id: `peer${index}`, views: 100 + index }));
  assert.equal(outlierBaseline(target, peers.slice(1), now).state, 'insufficient');
  const value = outlierBaseline(target, peers, now); assert.equal(value.sampleCount, 20); assert.equal(value.medianViews, 109.5); assert.equal(value.outlier, true);
  assert.equal(outlierBaseline({ ...target, live: true }, peers, now).state, 'excluded');
  assert.equal(outlierBaseline({ ...target, durationSeconds: 239 }, peers, now).state, 'excluded');
  assert.equal(outlierBaseline({ ...target, categoryId: '25' }, peers, now).outlier, false);
  assert.equal(outlierBaseline(target, peers.map((peer) => ({ ...peer, channelId: 'other' })), now).state, 'insufficient');
  assert.equal(outlierBaseline(target, peers.map((peer) => ({ ...peer, publishedAt: '2025-01-01' })), now).state, 'insufficient');
});
test('generic edits cannot forge approval history or disable an enabled pipeline', () => {
  assert.equal(protectedPipelineChange({}, { pipelineReviews: [{ approved: true }] }), true);
  assert.equal(protectedPipelineChange({ pipelineEnabled: true }, { pipelineEnabled: false }), true);
  assert.equal(protectedPipelineChange({}, { pipelineEnabled: true, evidence: 'source' }), false);
});
test('home month-to-date ignores future revenue and missing current records', () => {
  const rows = [record({ record_type: 'revenue', amount: 100, metadata: { date: '2026-08-01' } }), record({ record_type: 'revenue', amount: 500, metadata: { date: '2026-09-20' } })];
  const view = buildHomeRevenueView(rows, new Date('2026-09-01T10:00:00Z'));
  assert.equal(view.total.current, 0); assert.equal(view.total.monthChange, null);
});
