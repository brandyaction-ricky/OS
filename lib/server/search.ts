import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { searchSchema } from "@/lib/validation";
import type { DocumentStatus, SearchResult } from "@/lib/types";
import type { RequestActor } from "./auth";
import { createEmbeddings, toPgVector } from "./embeddings";
import { createServiceSupabase } from "@/lib/supabase/server";
import { hasLexicalEvidence, searchTerms } from "@/lib/search-relevance";

type SearchInput = z.infer<typeof searchSchema>;

interface SearchOutcome { results: SearchResult[]; degraded: boolean; }

function countOccurrences(value: string, term: string) {
  let count = 0;
  let offset = 0;
  while ((offset = value.indexOf(term, offset)) >= 0) {
    count += 1;
    offset += term.length;
  }
  return count;
}

function intersectStatuses(requested: DocumentStatus[], allowed: DocumentStatus[]) {
  return requested.filter((status) => allowed.includes(status));
}

async function addVersions(supabase: SupabaseClient, results: SearchResult[]) {
  const ids = [...new Set(results.map((result) => result.documentId))];
  if (!ids.length) return results;
  const { data } = await supabase.from("os_documents").select("id,current_version").in("id", ids);
  const versions = new Map((data ?? []).map((document) => [document.id, document.current_version]));
  return results.map((result) => ({ ...result, citation: { ...result.citation, version: versions.get(result.documentId) ?? null } }));
}

async function fallbackDocuments(actor: RequestActor, input: SearchInput, statuses: DocumentStatus[]): Promise<SearchResult[]> {
  const terms = searchTerms(input.query);
  if (!terms.length) return [];
  const filter = terms.flatMap((term) => [`title.ilike.%${term}%`, `content_md.ilike.%${term}%`]).join(",");
  let builder = actor.supabase
    .from("os_documents")
    .select("id,title,folder,status,brand,content_md,current_version,updated_at")
    .in("status", statuses)
    .or(filter)
    .order("updated_at", { ascending: false })
    .limit(Math.min(Math.max(input.topK * 6, 24), 60));
  if (input.filters.folder) builder = builder.eq("folder", input.filters.folder);
  if (actor.type === "agent" && statuses.some((status) => status !== "canonical")) {
    builder = builder.or(`status.eq.canonical,owner_id.eq.${actor.ownerId}`);
  }
  const brand = actor.brand ?? input.filters.brand;
  if (brand) builder = builder.eq("brand", brand);
  const { data } = await builder;
  const ranked = (data ?? []).map((document) => {
    const title = String(document.title ?? "").toLowerCase();
    const content = String(document.content_md ?? "").toLowerCase();
    const hits = terms.reduce((score, term) => score + countOccurrences(title, term) * 6 + Math.min(countOccurrences(content, term), 8), 0);
    return { document, hits };
  }).filter(({ hits }) => hits > 0).sort((left, right) => right.hits - left.hits).slice(0, input.topK);
  return ranked.map(({ document, hits }, index) => ({
    chunkId: null,
    documentId: document.id,
    title: document.title,
    folder: document.folder,
    status: document.status,
    brand: document.brand,
    heading: "본문",
    text: document.content_md.slice(0, 700),
    score: Math.max(0.2, Math.min(0.88, 0.45 + hits * 0.025 - index * 0.02)),
    citation: { documentId: document.id, version: document.current_version, chunkId: null },
  }));
}

export const searchInternals = { searchTerms };

export async function searchDocuments(actor: RequestActor, input: SearchInput): Promise<SearchOutcome> {
  const requested = (input.filters.statuses?.length ? input.filters.statuses : ["canonical", "reviewed", "team"]) as DocumentStatus[];
  const statuses = intersectStatuses(requested, actor.allowedStatuses);
  if (!statuses.length) return { results: [], degraded: false };

  let embedding: string | null = null;
  let degraded = false;
  if (input.mode !== "keyword") {
    if (process.env.OPENAI_API_KEY) embedding = toPgVector((await createEmbeddings([input.query]))[0]);
    else degraded = true;
  }

  // The vector RPC runs through the service client for PATs. Only canonical
  // rows may enter that query; personal agent-owned drafts are merged through
  // the explicitly owner-filtered keyword path below.
  const rpcStatuses = actor.type === "agent"
    ? statuses.filter((status) => status === "canonical")
    : statuses;
  const { data, error } = rpcStatuses.length ? await actor.supabase.rpc("os_search_knowledge", {
    p_query: input.query,
    p_embedding: embedding,
    p_limit: input.topK,
    p_statuses: rpcStatuses,
    p_folder: input.filters.folder || null,
    p_brand: actor.brand ?? input.filters.brand ?? null,
    p_min_score: 0,
  }) : { data: [], error: null };
  if (error) {
    const fallback = await fallbackDocuments(actor, input, statuses);
    return { results: fallback, degraded: true };
  }

  let results: SearchResult[] = (data ?? []).map((row: Record<string, unknown>) => ({
    chunkId: row.chunk_id as number,
    documentId: row.document_id as string,
    title: row.title as string,
    folder: (row.folder as string) ?? "",
    status: row.status as DocumentStatus,
    brand: (row.brand as string) ?? "",
    heading: (row.heading_path as string) ?? "본문",
    text: row.chunk_text as string,
    score: Number(row.score ?? 0),
    citation: { documentId: row.document_id as string, version: null, chunkId: row.chunk_id as number },
  }));
  // Without embeddings, the RPC can return low-signal full-text rows for an
  // unrelated sentence. Do not present those rows as evidence to chat users.
  if (degraded) results = results.filter((result) => hasLexicalEvidence(result, input.query));
  const sharedActor = actor.type === "user" ? { ...actor, supabase: createServiceSupabase() } : actor;
  const sharedKeyword = await fallbackDocuments(sharedActor, input, statuses);
  if (!results.length) results = sharedKeyword;
  else {
    const seen = new Set(results.map((result) => result.documentId));
    results = [...results, ...sharedKeyword.filter((result) => !seen.has(result.documentId))].slice(0, input.topK);
    results = await addVersions(sharedActor.supabase, results);
  }
  return { results, degraded };
}
