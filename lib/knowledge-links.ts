import type { DocumentStatus } from "./types";

export interface KnowledgeLinkSource {
  id: string;
  title: string;
  content_md: string;
  folder: string;
  status: DocumentStatus;
  owner_id: string;
}

export interface KnowledgeGraphNode {
  id: string;
  title: string;
  folder: string;
  status: DocumentStatus;
  ownerId: string;
  incoming: number;
  outgoing: number;
}

export interface KnowledgeGraphEdge {
  source: string;
  target: string;
}

export interface BrokenKnowledgeLink {
  sourceId: string;
  sourceTitle: string;
  targetTitle: string;
}

export interface KnowledgeGraph {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  broken: BrokenKnowledgeLink[];
}

const TEMPLATE_LINK = "다른 문서 이름";

export function extractWikiLinks(content: string) {
  return [...new Set(
    [...content.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]+)?\]\]/g)]
      .map((match) => match[1].trim())
      .filter(Boolean),
  )];
}

function titleKey(title: string) {
  return title.normalize("NFC").trim().toLocaleLowerCase("ko-KR");
}

export function buildKnowledgeGraph(documents: KnowledgeLinkSource[]): KnowledgeGraph {
  const active = documents.filter((document) => document.status !== "archived");
  const byTitle = new Map<string, KnowledgeLinkSource>();
  for (const document of active) {
    const key = titleKey(document.title);
    const current = byTitle.get(key);
    if (!current || (current.status !== "canonical" && document.status === "canonical")) byTitle.set(key, document);
  }

  const edges: KnowledgeGraphEdge[] = [];
  const broken: BrokenKnowledgeLink[] = [];
  const edgeKeys = new Set<string>();
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();

  for (const document of active) {
    for (const title of extractWikiLinks(document.content_md)) {
      if (title === TEMPLATE_LINK) continue;
      const target = byTitle.get(titleKey(title));
      if (!target) {
        broken.push({ sourceId: document.id, sourceTitle: document.title, targetTitle: title });
        continue;
      }
      if (target.id === document.id) continue;
      const edgeKey = `${document.id}:${target.id}`;
      if (edgeKeys.has(edgeKey)) continue;
      edgeKeys.add(edgeKey);
      edges.push({ source: document.id, target: target.id });
      outgoing.set(document.id, (outgoing.get(document.id) ?? 0) + 1);
      incoming.set(target.id, (incoming.get(target.id) ?? 0) + 1);
    }
  }

  return {
    nodes: active.map((document) => ({
      id: document.id,
      title: document.title,
      folder: document.folder,
      status: document.status,
      ownerId: document.owner_id,
      incoming: incoming.get(document.id) ?? 0,
      outgoing: outgoing.get(document.id) ?? 0,
    })),
    edges,
    broken,
  };
}
