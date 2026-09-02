import type { DocumentVersion, KnowledgeDocument, SearchResult } from "./types";
import type { KnowledgeGraph } from "./knowledge-links";
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

export async function getDocument(token: string | null, id: string) {
  return apiRequest<{ document: KnowledgeDocument }>(`/api/v1/documents/${encodeURIComponent(id)}`, { token });
}

export async function getKnowledgeGraph(token: string | null) {
  return apiRequest<KnowledgeGraph>("/api/v1/knowledge/graph", { token });
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

export async function listDocumentVersions(token: string | null, id: string) {
  return apiRequest<{ versions: DocumentVersion[] }>(`/api/v1/documents/${id}/versions`, { token });
}

export async function restoreDocumentVersion(token: string | null, id: string, version: number, expectedVersion: number) {
  return apiRequest<{ document: KnowledgeDocument }>(`/api/v1/documents/${id}/versions`, {
    method: "POST", token, body: JSON.stringify({ version, expectedVersion, reason: `v${version}로 되돌리기` }),
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

export interface RecordVersionSummary {
  eventId: number;
  version: number;
  eventType: string;
  title: string;
  changedFields: string[];
  note: string;
  createdAt: string;
}

export async function listRecordVersions(token: string | null, id: string) {
  return apiRequest<{ versions: RecordVersionSummary[] }>(`/api/v1/records/${encodeURIComponent(id)}/versions`, { token });
}

export async function restoreRecordVersion(token: string | null, id: string, version: number, expectedVersion: number) {
  return apiRequest<{ record: OsRecord }>(`/api/v1/records/${encodeURIComponent(id)}/versions`, {
    method: "POST", token, body: JSON.stringify({ version, expectedVersion, reason: `v${version}로 되돌리기` }),
  });
}

export async function uploadMeetingRecording(token: string | null, file: Blob) {
  const body = new FormData();
  body.set("file", file, `meeting-${Date.now()}.webm`);
  return apiRequest<{ path: string; size: number }>("/api/v1/meeting-recordings", {
    method: "POST", token, body,
  });
}

export async function transcribeMeeting(token: string | null, file: Blob) {
  const body = new FormData();
  body.set("file", file, `meeting-${Date.now()}.webm`);
  return apiRequest<{ transcript: string; mode: "ai" }>("/api/v1/meeting-transcription", { method: "POST", token, body });
}

export async function getMeetingRecordingUrl(token: string | null, path: string) {
  return apiRequest<{ url: string }>(`/api/v1/meeting-recordings?path=${encodeURIComponent(path)}`, { token });
}

export interface MeetingTodo { title: string; assignee: string; dueDate: string; dueLabel: string }
export interface MeetingSummaryResult { summary: string; decisions: string[]; pending: string[]; todos: MeetingTodo[]; mode: "ai" | "local" }

export async function summarizeMeeting(token: string | null, transcript: string, meetingDate?: string, business?: string) {
  return apiRequest<MeetingSummaryResult>("/api/v1/meeting-summary", {
    method: "POST", token, body: JSON.stringify({ transcript, meetingDate, business }),
  });
}

export async function prepareMeeting(token: string | null, brand = "", team = "") {
  const query = new URLSearchParams(); if (brand) query.set("brand", brand); if (team) query.set("team", team);
  return apiRequest<{ latestMeeting: { id: string; title: string; date: string | null; pending: string[] } | null; pending: string[]; todos: OsRecord[]; kpis: { id: string; title: string; current: number; previous: number; unit: string; signal: string }[] }>(`/api/v1/meeting-prep?${query}`, { token });
}

export async function getHealth() {
  return apiRequest<{
    ok: boolean;
    service: string;
    database: "ready" | "missing" | "error";
    auth: "ready" | "missing";
    accountPassword: "ready" | "missing";
    agentMcp: "ready" | "missing" | "error";
    embeddings: "ready" | "keyword_only";
    telegram: "ready" | "missing";
    contentAi: "ready" | "missing";
    youtube: "ready" | "missing";
    youtubeOAuth: "ready" | "missing";
    advertising: "ready" | "partial" | "missing";
    checkedAt: string;
  }>("/api/v1/health");
}

export interface AdPerformanceResponse {
  period: string;
  brand: "all" | "myin" | "brandyedu";
  range: { from: string; to: string };
  connections: Record<"meta" | "google", { configured: boolean; brands: Record<"myin" | "brandyedu", boolean> }>;
  rows: Array<{ provider: "meta" | "google"; brand_key: "myin" | "brandyedu"; metric_date: string; spend: number; attributed_revenue: number; conversions: number; impressions: number; clicks: number; currency: string; source_account: string }>;
  channels: Array<{ provider: "meta" | "google"; spend: number; attributedRevenue: number; conversions: number; impressions: number; clicks: number; roas: number; cpa: number; ctr: number }>;
  summary: { spend: number; attributedRevenue: number; conversions: number; impressions: number; clicks: number; roas: number; cpa: number; ctr: number; operatingRevenue: number; financeAdExpense: number | null };
  lastRuns: Array<{ provider: "meta" | "google"; brand_key: "myin" | "brandyedu"; status: string; rows_written: number; error_message: string; started_at: string; finished_at: string | null }>;
}

export async function getAdPerformance(token: string | null, input: { period: string; brand: "all" | "myin" | "brandyedu" }) {
  const query = new URLSearchParams(input);
  return apiRequest<AdPerformanceResponse>(`/api/v1/ad-performance?${query}`, { token });
}

export async function syncAdPerformance(token: string | null, input: { provider: "meta" | "google" | "all"; brands?: Array<"myin" | "brandyedu">; from: string; to: string }) {
  return apiRequest<{ ok: true; result: { results: Array<{ provider: string; brand: string; status: string; rows: number; error?: string }> } }>("/api/v1/ad-performance", {
    method: "POST", token, body: JSON.stringify(input),
  });
}

export async function importPerformanceCsv(token: string | null, input: { kind: "revenue" | "ads"; rows: unknown[] }) {
  return apiRequest<{ ok: true; imported: number }>("/api/v1/performance/import", {
    method: "POST", token, body: JSON.stringify(input),
  });
}

export interface EmbeddingQueueStatus {
  pending: number;
  running: number;
  failed: number;
  done: number;
}

export async function getIndexingStatus(token: string | null) {
  return apiRequest<{ queue: EmbeddingQueueStatus; configured: boolean; cronConfigured: boolean }>("/api/v1/indexing", { token });
}

export async function runIndexing(token: string | null, action: "process" | "retry_failed", limit = 25) {
  return apiRequest<{ result?: { attempted: number; completed: number; failed: number; remaining: number }; retried?: number; queue?: EmbeddingQueueStatus }>("/api/v1/indexing", {
    method: "POST", token, body: JSON.stringify({ action, limit }),
  });
}

export interface TelegramConnectionStatus {
  configured: boolean;
  bot?: { username: string | null; name: string | null };
  webhook: null | { url: string; pendingUpdates: number; lastErrorAt: number | null; lastError: string | null };
  pendingUsers?: { external_user_id: string; external_chat_id: string | null; display_name: string; username: string; status: "pending"; requested_at: string }[];
}

export async function getTelegramStatus(token: string | null) {
  return apiRequest<TelegramConnectionStatus>("/api/v1/telegram/setup", { token });
}

export async function connectTelegramWebhook(token: string | null) {
  return apiRequest<{ connected: boolean; url: string }>("/api/v1/telegram/setup", { method: "POST", token });
}

export async function decideTelegramUser(token: string | null, externalUserId: string, action: "approve" | "reject") {
  return apiRequest<{ user: { external_user_id: string; status: "approved" | "rejected" } }>("/api/v1/telegram/setup", {
    method: "PATCH", token, body: JSON.stringify({ externalUserId, action }),
  });
}

export interface AgentAccessKey {
  id: string;
  name: string;
  key_prefix: string;
  team: string;
  brand: string | null;
  scopes: string[];
  allowed_statuses: string[];
  owner_user_id: string;
  active: boolean;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  owner: { id: string; display_name: string; email: string; is_active: boolean } | null;
}

export interface AgentAccessResponse {
  organization: { id: string; slug: string; name: string };
  keys: AgentAccessKey[];
}

export async function listAgentKeys(token: string | null) {
  return apiRequest<AgentAccessResponse>("/api/v1/agent-keys", { token });
}

export async function createAgentKey(token: string | null, input: {
  name: string;
  ownerUserId: string;
  access: "read" | "write";
  team?: string;
  brand?: string | null;
  expiresAt?: string | null;
}) {
  return apiRequest<{
    key: AgentAccessKey;
    organization: AgentAccessResponse["organization"];
    token: string;
    warning: string;
  }>("/api/v1/agent-keys", { method: "POST", token, body: JSON.stringify(input) });
}

export async function revokeAgentKey(token: string | null, id: string) {
  return apiRequest<{ revoked: boolean }>(`/api/v1/agent-keys?id=${encodeURIComponent(id)}`, { method: "DELETE", token });
}

export async function generateContent(token: string | null, input: {
  action: "topic_plan" | "script_draft" | "derivatives" | "title_package" | "shorts_proposal" | "youtube_kit";
  sourceId: string;
  platforms?: Array<"shorts" | "threads" | "column" | "instagram" | "essay">;
  count?: number;
  marketEvidence?: Array<Pick<YoutubeMarketItem, "title" | "channelTitle" | "viewCount" | "url">>;
}) {
  return apiRequest<{ configured: boolean; queued: boolean; records?: OsRecord[]; job?: OsRecord }>("/api/v1/content/generate", {
    method: "POST", token, body: JSON.stringify(input),
  });
}

export interface ContentSnapshotImportResult {
  ok: true;
  counts: { created: number; updated: number; skipped: number; sources: number; derivatives: number; metrics: number };
}

export async function importContentSnapshot(token: string | null, snapshot: unknown) {
  return apiRequest<ContentSnapshotImportResult>("/api/v1/content/import", {
    method: "POST", token, body: JSON.stringify(snapshot),
  });
}

export async function createContentMediaUpload(token: string | null, input: { sourceId: string; fileName: string; fileSize: number; mimeType: string }) {
  return apiRequest<{ path: string; token: string; fileName: string; fileSize: number; mimeType: string; retentionHours: number }>("/api/v1/content/media", {
    method: "POST", token, body: JSON.stringify(input),
  });
}

export async function uploadContentMedia(path: string, signedToken: string, file: File) {
  const { getBrowserSupabase } = await import("@/lib/supabase/client");
  const client = getBrowserSupabase();
  if (!client) throw new Error("파일 저장소 연결 정보가 없습니다.");
  const { error } = await client.storage.from("os-content-media").uploadToSignedUrl(path, signedToken, file, {
    contentType: file.type || "video/mp4",
    cacheControl: "3600",
  });
  if (error) throw new Error(error.message || "영상 원본을 저장하지 못했습니다.");
  return { path };
}

export async function getContentMediaUrl(token: string | null, path: string) {
  return apiRequest<{ url: string; expiresIn: number }>(`/api/v1/content/media?path=${encodeURIComponent(path)}`, { token });
}

export interface YoutubeMarketItem {
  id: string;
  title: string;
  channelTitle: string;
  publishedAt: string | null;
  thumbnail: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  durationSeconds: number;
  subscribers: number | null;
  viewSubscriberRatio: number | null;
  url: string;
}

export async function searchYoutubeMarket(token: string | null, query: string, maxResults = 12) {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  return apiRequest<{ query: string; configured: boolean; items: YoutubeMarketItem[] }>(`/api/v1/youtube/search?${params}`, { token });
}

export interface YoutubeChannelIdentity {
  id: string;
  title: string;
  description: string;
  handle: string;
  thumbnail: string;
  subscribers: number;
  videos: number;
  views: number;
  url: string;
}

export async function resolveYoutubeChannel(token: string | null, query: string) {
  const params = new URLSearchParams({ q: query });
  return apiRequest<{ channel: YoutubeChannelIdentity }>(`/api/v1/youtube/channel?${params}`, { token });
}

export interface YoutubeOAuthStatus {
  configured: boolean;
  canManage: boolean;
  connected: boolean;
  channelId: string | null;
  channelTitle: string | null;
  connectedAt: string | null;
}

export async function getYoutubeOAuthStatus(token: string | null) {
  return apiRequest<YoutubeOAuthStatus>("/api/v1/youtube/oauth", { token });
}

export async function startYoutubeOAuth(token: string | null) {
  return apiRequest<{ authorizationUrl: string }>("/api/v1/youtube/oauth", { method: "POST", token });
}

export async function disconnectYoutubeOAuth(token: string | null) {
  return apiRequest<{ disconnected: true }>("/api/v1/youtube/oauth", { method: "DELETE", token });
}

export async function createYoutubeUploadSession(token: string | null, input: { kitId: string; fileName: string; fileSize: number; mimeType: string; privacyStatus: "private" | "unlisted"; finalApproval: true }) {
  return apiRequest<{ uploadUrl: string; kitId: string; privacyStatus: "private" | "unlisted"; fileName: string }>("/api/v1/youtube/upload/session", { method: "POST", token, body: JSON.stringify(input) });
}

export function uploadYoutubeFile(uploadUrl: string, file: File, onProgress: (percent: number) => void) {
  return new Promise<{ id: string }>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", uploadUrl); request.setRequestHeader("content-type", file.type || "video/mp4");
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    request.onerror = () => reject(new Error("YouTube로 영상 파일을 전송하지 못했습니다."));
    request.onload = () => {
      let body: { id?: string; error?: { message?: string } } = {};
      try { body = JSON.parse(request.responseText || "{}"); } catch { /* handled below */ }
      if (request.status < 200 || request.status >= 300 || !body.id) return reject(new Error(body.error?.message || `YouTube 업로드에 실패했습니다. (${request.status})`));
      onProgress(100); resolve({ id: body.id });
    };
    request.send(file);
  });
}

export async function completeYoutubeUpload(token: string | null, input: { kitId: string; videoId: string; privacyStatus: "private" | "unlisted"; finalApproval: true }) {
  return apiRequest<{ uploaded: true; videoId: string; videoUrl: string; privacyStatus: string }>("/api/v1/youtube/upload/complete", { method: "POST", token, body: JSON.stringify(input) });
}

export async function uploadCompanyFile(token: string | null, file: File) {
  const body = new FormData(); body.set("file", file, file.name);
  return apiRequest<{ path: string; name: string; size: number }>("/api/v1/company-files", { method: "POST", token, body });
}

export async function getCompanyFileUrl(token: string | null, path: string) {
  return apiRequest<{ url: string }>(`/api/v1/company-files?path=${encodeURIComponent(path)}`, { token });
}

export interface OsMember {
  id: string;
  email: string;
  display_name: string;
  legal_name?: string;
  role: "member" | "lead" | "admin";
  team: string;
  is_active: boolean;
  affiliation: string;
  roles: string[];
  onboarding: Record<string, boolean>;
  finance_access: boolean;
  account_connected?: boolean;
  must_change_password?: boolean;
}

export async function listMembers(token: string | null) {
  return apiRequest<{ members: OsMember[] }>("/api/v1/members", { token });
}
