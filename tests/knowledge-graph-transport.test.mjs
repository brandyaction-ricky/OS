import test from 'node:test';
import assert from 'node:assert/strict';
import { packKnowledgeGraph, unpackKnowledgeGraph } from '../lib/knowledge/graph-transport.ts';

function fixture() {
  const nodes = Array.from({ length: 1000 }, (_, i) => ({ id: `99000000-0000-4000-8000-${String(i).padStart(12, '0')}`, title: `문서 ${i}`, folder: '', status: 'team', ownerId: '96000000-0000-4000-8000-000000000001', currentVersion: 1, stewardId: null, incoming: 5, outgoing: 5, space: 'team', updatedAt: '2026-10-09T00:00:00Z' }));
  return { nodes, edges: nodes.flatMap((n, i) => Array.from({ length: 5 }, (_, k) => ({ source: n.id, target: nodes[(i + k + 1) % nodes.length].id }))), broken: [], totalLinks: 5000, stewardReady: true, hiddenTargets: 0 };
}
test('indexed graph is lossless and below 300KB for 1000 nodes/5000 edges', () => {
  const graph = fixture(), packed = packKnowledgeGraph(graph);
  assert.deepEqual(unpackKnowledgeGraph(packed), graph);
  assert.ok(Buffer.byteLength(JSON.stringify(packed)) < 300000);
  assert.equal(unpackKnowledgeGraph(graph), graph);
});
test('packing never adds filtered endpoints or retains dangling identifiers', () => {
  const graph = fixture(); graph.edges.push({ source: graph.nodes[0].id, target: 'inaccessible-id' });
  const packed = packKnowledgeGraph(graph);
  assert.equal(packed.edges.length, 5000);
  assert.ok(!JSON.stringify(packed).includes('inaccessible-id'));
});
