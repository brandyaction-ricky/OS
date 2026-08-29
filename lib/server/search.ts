import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { searchSchema } from "@/lib/validation";
import type { DocumentStatus, SearchResult } from "@/lib/types";
import type { RequestActor } from "./auth";
import { createEmbeddings, toPgVector } from "./embeddings";

type SearchInput = z.infer<typeof searchSchema>;

interface SearchOutcome { results: SearchResult[]; degraded: boolean; }

const SEARCH_STOP_WORDS = new Set([
  "뭐", "뭐냐", "뭔가", "어떤", "어떤거", "어떤게", "알려줘", "알려", "보여줘", "보여",
  "찾아줘", "찾아", "있나", "있어", "있는지", "인가", "이야", "해줘", "대한", "관련",
  "the", "a", "an", "what", "which", "show", "find", "tell", "about",
]);

function searchTerms(value: string) {
  const normalized = value
    .replace(/@[A-Za-z0-9_]+/g, " ")
    .replace(/[%_,().?!/\\:;\[\]{}'\"`~@#$^&*+=|<>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const words = normalized.split(" ").filter((word) => word.length >= 2 && !SEARCH_STOP_WORDS.has(word));
  const terms = new Set<string>();
  for (const word of words) {
    terms.add(word);
    if (/^[가-힣]{4,}$/.test(word)) {
      for (let index = 0; index < word.length - 1; index += 2) terms.add(word.slice(index, index + 2));
      terms.add(word.slice(-2));
    }
  }
  return [...terms].filter((term) => term.length >= 2).slice(0, 8);
}

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

  const { data, error } = await actor.supabase.rpc("os_search_knowledge", {
    p_query: input.query,
    p_embedding: embedding,
    p_limit: input.topK,
    p_statuses: statuses,
    p_folder: input.filters.folder || null,
    p_brand: actor.brand ?? input.filters.brand ?? null,
    p_min_score: 0,
  });
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
  if (!results.length) results = await fallbackDocuments(actor, input, statuses);
  else results = await addVersions(actor.supabase, results);
  return { results, degraded };
}
