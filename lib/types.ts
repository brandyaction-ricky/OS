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
  parent_document_id?: string | null;
  page_order?: number;
  status: DocumentStatus;
  brand: string;
  team: string;
  tags: string[];
  source: string;
  source_ref: string | null;
  owner_id: string;
  steward_id?: string | null;
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

export interface DocumentProposal {
  id: string;
  document_id: string;
  base_version: number;
  title: string;
  content_md: string;
  folder: string;
  brand: string;
  team: string;
  tags: string[];
  author_id: string;
  agent_key_id: string | null;
  status: "open" | "approved" | "returned" | "withdrawn";
  reviewer_id?: string | null;
  decided_at?: string | null;
  note?: string;
  created_at: string;
  updated_at?: string;
}

export interface DocumentProposalComment {
  id: string;
  proposal_id: string;
  line_no: number;
  body: string;
  author_id: string;
  created_at: string;
  resolved_at?: string | null;
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
  isActive?: boolean;
  financeAccess?: boolean;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
