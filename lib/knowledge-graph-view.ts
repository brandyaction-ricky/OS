import type { KnowledgeGraph } from "./knowledge-links";

export function graphView(graph: KnowledgeGraph, selectedId: string | null, query: string, folder: string, depth: number, limit: number) {
  const text = query.trim().toLocaleLowerCase("ko-KR");
  const matches = graph.nodes.filter(node => (!folder || node.folder === folder || node.folder.startsWith(folder + "/")) && (!text || (node.title + " " + node.folder).toLocaleLowerCase("ko-KR").includes(text)));
  const allowed = new Set(matches.map(node => node.id));
  const ranked = [...matches].sort((a,b) => b.incoming + b.outgoing - a.incoming - a.outgoing || a.title.localeCompare(b.title,"ko"));
  const ids = new Set<string>();
  const cap = Math.max(1, Math.min(72, limit));
  if (selectedId && allowed.has(selectedId)) {
    ids.add(selectedId);
    let frontier = new Set([selectedId]);
    for (let level = 0; level < Math.max(1, Math.min(2, depth)); level++) {
      const next = new Set<string>();
      for (const edge of graph.edges) {
        if (frontier.has(edge.source) && allowed.has(edge.target)) next.add(edge.target);
        if (frontier.has(edge.target) && allowed.has(edge.source)) next.add(edge.source);
      }
      for (const node of ranked) if (next.has(node.id) && ids.size < cap) ids.add(node.id);
      frontier = next;
    }
  } else for (const node of ranked.slice(0, cap)) ids.add(node.id);
  return { matches: ranked, nodes: [...ids].map(id => matches.find(node => node.id === id)!), ids };
}

export function changedLineRange(before: string, after: string) {
  const oldLines = before.replace(/\r\n?/g,"\n").split("\n");
  const newLines = after.replace(/\r\n?/g,"\n").split("\n");
  let start = 0;
  while (start < Math.min(oldLines.length,newLines.length) && oldLines[start] === newLines[start]) start++;
  let oldEnd = oldLines.length, newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd-1] === newLines[newEnd-1]) { oldEnd--; newEnd--; }
  return { start: start + 1, removed: oldLines.slice(start,oldEnd), added: newLines.slice(start,newEnd), same: start === oldEnd && start === newEnd };
}
