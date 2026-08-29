import type { KnowledgeDocument, SearchResult } from "./types";
import type { OsRecord, RecordType } from "./record-types";

interface RequestOptions extends RequestInit {
  token?: string | null;
}

async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("accept", "application/json");
  if (options.body) headers.set("content-type", "application/json");
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);

  const response = await fetch(path, { ...options, headers, cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.error?.message ?? `요청을 처리하지 못했습니다. (${response.status})`;
    throw new Error(message);
  }
  return body as T;
}

export async function listDocuments(token: string | null, query = "") {
  const suffix = query ? `?${query}` : "";
  return apiRequest<{ documents: KnowledgeDocument[]; total: number }>(`/api/v1/documents${suffix}`, {
    token,
  });
}

export async function createDocument(
  token: string | null,
  input: { title: string; content: string; folder?: string; brand?: string; team?: string; tags?: string[]; source?: string; sourceRef?: string | null },
) {
  return apiRequest<{ document: KnowledgeDocument; indexing: string }>("/api/v1/documents", {
    method: "POST",
    token,
    body: JSON.stringify(input),
  });
}

export async function updateDocument(
  token: string | null,
  input: {
    id: string;
    expectedVersion: number;
    title?: string;
    content?: string;
    folder?: string;
    brand?: string;
    team?: string;
    tags?: string[];
    reason?: string;
  },
) {
  return apiRequest<{ document: KnowledgeDocument; indexing: string }>("/api/v1/documents", {
    method: "PATCH",
    token,
    body: JSON.stringify(input),
  });
}

export async function deleteDocument(token: string | null, id: string) {
  return apiRequest<{ deleted: boolean }>(`/api/v1/documents?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    token,
  });
}

export async function changeDocumentStatus(token: string | null, id: string, status: string, note = "") {
  return apiRequest<{ document: KnowledgeDocument }>(`/api/v1/documents/${id}/status`, {
    method: "POST",
    token,
    body: JSON.stringify({ status, note }),
  });
}

export async function searchKnowledge(
  token: string | null,
  input: {
    query: string;
    mode?: "hybrid" | "keyword" | "semantic";
    topK?: number;
    filters?: { statuses?: string[]; folder?: string; brand?: string };
  },
) {
  return apiRequest<{
    query: string;
    mode: string;
    degraded: boolean;
    results: SearchResult[];
    tookMs: number;
  }>("/api/v1/search", {
    method: "POST",
    token,
    body: JSON.stringify(input),
  });
}

export async function listRecords(token: string | null, recordType: RecordType, query = "") {
  const params = new URLSearchParams(query);
  params.set("type", recordType);
  return apiRequest<{ records: OsRecord[]; total: number }>(`/api/v1/records?${params}`, { token });
}

export async function listAllRecords(token: string | null, query = "limit=200") {
  return apiRequest<{ records: OsRecord[]; total: number }>(`/api/v1/records?${query}`, { token });
}

export async function createRecord(token: string | null, input: Record<string, unknown>) {
  return apiRequest<{ record: OsRecord }>("/api/v1/records", {
    method: "POST", token, body: JSON.stringify(input),
  });
}

export async function updateRecord(token: string | null, input: Record<string, unknown>) {
  return apiRequest<{ record: OsRecord }>("/api/v1/records", {
    method: "PATCH", token, body: JSON.stringify(input),
  });
}

export async function archiveRecord(token: string | null, id: string) {
  return apiRequest<{ archived: boolean }>(`/api/v1/records?id=${encodeURIComponent(id)}`, {
    method: "DELETE", token,
  });
}
