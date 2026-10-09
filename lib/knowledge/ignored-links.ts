import type { KnowledgeGraph } from "../knowledge-links";
export function withIgnoredLinks(graph:KnowledgeGraph,events:Array<{action:string;target_id:string;detail:Record<string,unknown>}>):KnowledgeGraph {
  const versions=new Map(graph.nodes.map(node=>[node.id,node.currentVersion]));
  const ignored=new Set(events.filter(event=>event.action==="link_ignore"&&Number(event.detail.sourceVersion)===versions.get(event.target_id)).map(event=>event.target_id+"\n"+String(event.detail.target)));
  return {...graph,broken:graph.broken.filter(link=>!ignored.has(link.sourceId+"\n"+link.targetTitle))};
}
