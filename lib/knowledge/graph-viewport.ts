import type { KnowledgeGraph } from "../knowledge-links";
import { neighborIds } from "./force";

/** Bound drawing work after ACL filtering, without silently dropping the selected node. */
export function graphViewport(graph: KnowledgeGraph, options: {
  spaces: string[]; hideOrphans: boolean; selected: string; around: boolean; depth: number; full: boolean;
}) {
  const eligible = graph.nodes.filter(n => options.spaces.includes(n.space ?? "team") && (!options.hideOrphans || n.incoming + n.outgoing > 0));
  const eligibleIds = new Set(eligible.map(n => n.id));
  const ranked = [...eligible].sort((a, b) => Number(b.status === "canonical") - Number(a.status === "canonical") || (b.incoming + b.outgoing) - (a.incoming + a.outgoing) || a.id.localeCompare(b.id));
  const automatic = eligible.length > 1000 && !(options.full && eligible.length <= 2000);
  const focusId = eligibleIds.has(options.selected) ? options.selected : automatic ? ranked[0]?.id ?? "" : "";
  const neighbors = focusId && (automatic || options.around)
    ? neighborIds(graph.edges.filter(e => eligibleIds.has(e.source) && eligibleIds.has(e.target)), focusId, automatic ? 2 : options.depth) : null;
  const matching = eligible.filter(n => !neighbors || neighbors.has(n.id));
  const limit = options.full && eligible.length <= 2000 ? 2000 : 1000;
  const nodes = matching.length <= limit ? matching : [...matching].sort((a, b) => Number(b.id === focusId) - Number(a.id === focusId) || b.incoming + b.outgoing - a.incoming - a.outgoing).slice(0, limit);
  return { nodes, automatic, focusId, filteredCount: eligible.length, truncated: matching.length > nodes.length };
}
