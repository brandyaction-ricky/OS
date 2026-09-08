import type { DocumentStatus } from "./types";

export interface KnowledgeLinkSource {
  id: string;
  title: string;
  content_md: string;
  folder: string;
  status: DocumentStatus;
  owner_id: string;
  source_ref?: string | null;
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

export function wikiKey(raw: string) {
  let value = raw.split("|")[0].split("#")[0].trim();
  try { value = decodeURIComponent(value); } catch { /* Preserve literal percent signs. */ }
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\.md$/i, "")
    .normalize("NFC").trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, " ");
}

export function documentLinkKeys(document: Pick<KnowledgeLinkSource, "title" | "folder" | "source_ref">) {
  const source = wikiKey(document.source_ref ?? "");
  const file = source.split("/").pop() ?? "";
  return [...new Set([wikiKey(document.title), source, file, wikiKey(`${document.folder}/${document.title}`)].filter(Boolean))];
}

export function resolveWikiLink<T extends Pick<KnowledgeLinkSource, "id" | "title" | "folder" | "status" | "source_ref">>(raw: string, documents: T[], sourceFolder = "") {
  const key = wikiKey(raw);
  const candidates = documents.filter((document) => document.status !== "archived" && documentLinkKeys(document).includes(key));
  if (candidates.length === 1) return candidates[0];
  const nearby = candidates.filter((document) => wikiKey(document.folder) === wikiKey(sourceFolder));
  if (nearby.length === 1) return nearby[0];
  const canonical = candidates.filter((document) => document.status === "canonical");
  return canonical.length === 1 ? canonical[0] : undefined;
}

export function buildKnowledgeGraph(documents: KnowledgeLinkSource[]): KnowledgeGraph {
  const active = documents.filter((document) => document.status !== "archived");
  const byTitle = new Map<string, KnowledgeLinkSource[]>();
  for (const document of active) {
    for (const key of documentLinkKeys(document)) byTitle.set(key, [...(byTitle.get(key) ?? []), document]);
  }

  const edges: KnowledgeGraphEdge[] = [];
  const broken: BrokenKnowledgeLink[] = [];
  const edgeKeys = new Set<string>();
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();

  for (const document of active) {
    for (const title of extractWikiLinks(document.content_md)) {
      if (title === TEMPLATE_LINK) continue;
      const target = resolveWikiLink(title, byTitle.get(wikiKey(title)) ?? [], document.folder);
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
