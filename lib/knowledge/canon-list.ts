import type { KnowledgeActor } from "./access";
import type { KnowledgeDocument } from "../types";

export type CanonListDocument = Pick<KnowledgeDocument, "id" | "title" | "folder" | "steward_id" | "review_due_on" | "current_version" | "updated_at">;
export interface CanonListSnapshot {
  documents: CanonListDocument[];
  people: Array<{ id: string; display_name: string }>;
  proposalDocumentIds: string[];
  actor: KnowledgeActor;
}
