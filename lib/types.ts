export const DOCUMENT_STATUSES = [
  "draft",
  "team",
  "review",
  "reviewed",
  "canonical",
  "archived",
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export type OsRole = "member" | "lead" | "admin";

export interface KnowledgeDocument {
  id: string;
  title: string;
  content_md: string;
  folder: string;
  status: DocumentStatus;
  brand: string;
  team: string;
  tags: string[];
  source: string;
  source_ref: string | null;
  owner_id: string;
  created_by: string;
  current_version: number;
  created_at: string;
  updated_at: string;
}

export interface DocumentVersion {
  version_no: number;
  title: string;
  content_md: string;
  author_id: string | null;
  agent_key_id?: string | null;
  author_name: string;
  reason: string;
  created_at: string;
}

export interface SearchResult {
  chunkId: number | string | null;
  documentId: string;
  title: string;
  folder: string;
  status: DocumentStatus;
  brand: string;
  heading: string;
  text: string;
  score: number;
  citation: {
    documentId: string;
    version: number | null;
    chunkId: number | string | null;
  };
}

export interface SessionProfile {
  id: string;
  email: string;
  displayName: string;
  role: OsRole;
  team: string;
  mustChangePassword: boolean;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
