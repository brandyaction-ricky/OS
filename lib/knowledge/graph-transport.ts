import type { KnowledgeGraph, KnowledgeGraphNode } from "../knowledge-links";

/** Optional wire format: preserve the legacy API while avoiding repeated UUIDs per edge. */
type NodeTuple = [string, string, string, KnowledgeGraphNode["status"], string, number | null, string | null, number, number, KnowledgeGraphNode["space"] | null, string | null];
export interface CompactKnowledgeGraph {
  format: "indexed-v1";
  nodes: NodeTuple[];
  edges: [number, number][];
  broken: KnowledgeGraph["broken"];
  totalLinks?: number;
  stewardReady?: boolean;
  hiddenTargets?: number;
}
export function packKnowledgeGraph(graph: KnowledgeGraph): CompactKnowledgeGraph {
  const index = new Map(graph.nodes.map((node, i) => [node.id, i]));
  return {
    ...graph, format: "indexed-v1",
    nodes: graph.nodes.map(n => [n.id, n.title, n.folder, n.status, n.ownerId, n.currentVersion ?? null, n.stewardId ?? null, n.incoming, n.outgoing, n.space ?? null, n.updatedAt ?? null]),
    edges: graph.edges.flatMap(e => {
      const source = index.get(e.source), target = index.get(e.target);
      return source === undefined || target === undefined ? [] : [[source, target] as [number, number]];
    }),
  };
}
export function unpackKnowledgeGraph(value: KnowledgeGraph | CompactKnowledgeGraph): KnowledgeGraph {
  if (!("format" in value) || value.format !== "indexed-v1") return value as KnowledgeGraph;
  const nodes: KnowledgeGraphNode[] = value.nodes.map(n => ({ id: n[0], title: n[1], folder: n[2], status: n[3], ownerId: n[4], currentVersion: n[5] ?? undefined, stewardId: n[6], incoming: n[7], outgoing: n[8], space: n[9] ?? undefined, updatedAt: n[10] ?? undefined }));
  const edges = value.edges.flatMap(([source, target]) => nodes[source] && nodes[target] ? [{ source: nodes[source].id, target: nodes[target].id }] : []);
  return { nodes, edges, broken: value.broken, totalLinks: value.totalLinks, stewardReady: value.stewardReady, hiddenTargets: value.hiddenTargets };
}
