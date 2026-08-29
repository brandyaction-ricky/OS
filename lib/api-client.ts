import type { KnowledgeDocument, SearchResult } from "./types";
import type { OsRecord, RecordType } from "./record-types";

interface RequestOptions extends RequestInit {
  token?: string | null;
}

async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("accept", "application/json");
  if (options.body && !(options.body instanceof FormData)) headers.set("content-type", "application/json");
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

export async function uploadMeetingRecording(token: string | null, file: Blob) {
  const body = new FormData();
  body.set("file", file, `meeting-${Date.now()}.webm`);
  return apiRequest<{ path: string; size: number }>("/api/v1/meeting-recordings", {
    method: "POST", token, body,
  });
}

export async function getMeetingRecordingUrl(token: string | null, path: string) {
  return apiRequest<{ url: string }>(`/api/v1/meeting-recordings?path=${encodeURIComponent(path)}`, { token });
}

export async function summarizeMeeting(token: string | null, transcript: string) {
  return apiRequest<{ summary: string; mode: "ai" | "local" }>("/api/v1/meeting-summary", {
    method: "POST", token, body: JSON.stringify({ transcript }),
  });
}

export async function getHealth() {
  return apiRequest<{
    ok: boolean;
    service: string;
    database: "ready" | "missing" | "error";
    auth: "ready" | "missing";
    embeddings: "ready" | "keyword_only";
    telegram: "ready" | "missing";
    checkedAt: string;
  }>("/api/v1/health");
}

export interface OsMember {
  id: string;
  email: string;
  display_name: string;
  role: "member" | "lead" | "admin";
  team: string;
  is_active: boolean;
}

export async function listMembers(token: string | null) {
  return apiRequest<{ members: OsMember[] }>("/api/v1/members", { token });
}
