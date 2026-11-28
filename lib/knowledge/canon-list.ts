import type { KnowledgeActor } from "./access";
import type { KnowledgeDocument } from "../types";

export type CanonListDocument = Pick<KnowledgeDocument, "id" | "title" | "folder" | "steward_id" | "review_due_on" | "current_version" | "updated_at"> & { library?: boolean };
/** A role of the 업무 표 with its document; `issue` says why that document is not usable canon (title only for admins). */
export interface CanonRole { key: string; id: string; scope: string; issue: string | null; title?: string }
export interface CanonListSnapshot {
  documents: CanonListDocument[];
  people: Array<{ id: string; display_name: string }>;
  proposalDocumentIds: string[];
  actor: KnowledgeActor;
  roles?: CanonRole[];
}
