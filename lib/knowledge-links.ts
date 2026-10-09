import type { DocumentStatus } from "./types";

export interface KnowledgeLinkSource {
  id: string;
  title: string;
  content_md: string;
  folder: string;
  status: DocumentStatus;
  owner_id: string;
  source_ref?: string | null;
  current_version?: number;
  steward_id?: string | null;
  parent_document_id?: string | null;
  source?: string;
  meeting_record_id?: string | null;
  updated_at?: string;
}

export interface KnowledgeGraphNode {
  id: string;
  title: string;
  folder: string;
  status: DocumentStatus;
  ownerId: string;
  currentVersion?: number;
  stewardId?: string | null;
  incoming: number;
  outgoing: number;
  space?: "mine" | "team" | "canon" | "meet" | "ai";
  updatedAt?: string;
}

export interface KnowledgeGraphEdge {
  source: string;
  target: string;
}

export interface BrokenKnowledgeLink {
  sourceId: string;
  sourceTitle: string;
  targetTitle: string;
  reason?: "missing" | "ambiguous";
  candidates?: Array<{id: string; title: string; folder: string}>;
}

export interface KnowledgeGraph {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  broken: BrokenKnowledgeLink[];
  totalLinks?: number;
  stewardReady?: boolean;
  hiddenTargets?: number;
}

const TEMPLATE_LINK = "다른 문서 이름";

export function extractWikiLinks(content: string) {
  return [...new Set(
    [...content.matchAll(/(?<!!)\[\[([^\]|#]+)(?:[#|][^\]]+)?\]\]/g)]
      .map((match) => match[1].trim())
      .filter(value => Boolean(value) && !/\.(?:png|jpe?g|gif|webp|svg|pdf|mp4|mov|zip|csv|xlsx|docx|pptx|hwp)$/i.test(value)),
  )];
}

export function replaceWikiLinkTarget(content: string, oldTarget: string, newTarget: string) {
  let count = 0;
  const next = content.replace(/(^|[^!])\[\[([^\]|#]+)((?:[#|][^\]]+)?)\]\]/gm, (whole, prefix: string, target: string, suffix: string) => {
    if (wikiKey(target) !== wikiKey(oldTarget)) return whole;
    count += 1;
    return `${prefix}[[${newTarget}${suffix}]]`;
  });
  return { content: next, count };
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
  const byId = documents.find(document => document.id === raw && document.status !== "archived");
  if (byId) return byId;
  const candidates = documents.filter((document) => document.status !== "archived" && documentLinkKeys(document).includes(key));
  if (candidates.length === 1) return candidates[0];
  const nearby = candidates.filter((document) => wikiKey(document.folder) === wikiKey(sourceFolder));
  if (nearby.length === 1) return nearby[0];
  const canonical = candidates.filter((document) => document.status === "canonical");
  return canonical.length === 1 ? canonical[0] : undefined;
}

export function buildKnowledgeGraph(documents: KnowledgeLinkSource[], visibleIds?: ReadonlySet<string>): KnowledgeGraph {
  const active = documents.filter((document) => document.status !== "archived");
  const visible = (id: string) => !visibleIds || visibleIds.has(id);
  const byId = new Map(active.map(document=>[document.id,document]));
  const compactTitle = new Map<string, KnowledgeLinkSource[]>();
  const byTitle = new Map<string, KnowledgeLinkSource[]>();
  for (const document of active) {
    const compact=wikiKey(document.title).replace(/\s/g,"");compactTitle.set(compact,[...(compactTitle.get(compact)??[]),document]);
    for (const key of documentLinkKeys(document)) byTitle.set(key, [...(byTitle.get(key) ?? []), document]);
  }

  const edges: KnowledgeGraphEdge[] = [];
  const broken: BrokenKnowledgeLink[] = [];
  const edgeKeys = new Set<string>();
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  let totalLinks = 0;
  let hiddenTargets = 0;

  for (const document of active) {
    if (!visible(document.id)) continue;
    for (const title of extractWikiLinks(document.content_md)) {
      if (title === TEMPLATE_LINK) continue;
      totalLinks += 1;
      const target = byId.get(title) ?? resolveWikiLink(title, byTitle.get(wikiKey(title)) ?? [], document.folder);
      if (!target) {
        const candidates = byTitle.get(wikiKey(title)) ?? [];
        if (candidates.some(item => !visible(item.id))) { hiddenTargets += 1; continue; }
        const suggestions = candidates.length ? candidates : (compactTitle.get(wikiKey(title).replace(/\s/g, ""))??[]).filter(item => visible(item.id));
        broken.push({ sourceId: document.id, sourceTitle: document.title, targetTitle: title, reason: candidates.length > 1 ? "ambiguous" : "missing", candidates: suggestions.map(item => ({id: item.id, title: item.title, folder: item.folder})) });
        continue;
      }
      if (!visible(target.id)) { hiddenTargets += 1; continue; }
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
    nodes: active.filter(document => visible(document.id)).map((document) => ({
      id: document.id,
      title: document.title,
      folder: document.folder,
      status: document.status,
      ownerId: document.owner_id,
      currentVersion: document.current_version,
      stewardId: document.steward_id,
      incoming: incoming.get(document.id) ?? 0,
      outgoing: outgoing.get(document.id) ?? 0,
      space: document.meeting_record_id ? "meet" : document.status === "canonical" ? "canon" : document.source === "mcp" ? "ai" : document.status === "draft" ? "mine" : "team",
      updatedAt: document.updated_at,
    })),
    edges,
    broken,
    totalLinks,
    hiddenTargets,
  };
}
