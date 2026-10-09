import type { DocumentStatus, KnowledgeDocument } from "@/lib/types";
import type { RequestActor } from "./auth";
import { canReadDocument } from "../knowledge/access.ts";

type ReadableDocument = Pick<KnowledgeDocument, "owner_id" | "status"> & Partial<Pick<KnowledgeDocument, "source">>;
type DocumentActor = Pick<RequestActor, "allowedStatuses" | "ownerId" | "role" | "type">;

export function agentReadableStatuses(configured: DocumentStatus[], canWrite = false) {
  // Read scope includes team references and own MCP drafts, regardless of the
  // separately configured write tier. The document policy enforces ownership/source.
  return [...new Set([...configured, "team" as const, "draft" as const, ...(canWrite ? ["canonical" as const] : [])])];
}
export function canAgentWriteDocument(actor: Pick<RequestActor, "type" | "allowedStatuses" | "writableStatuses">, status: DocumentStatus) {
  return actor.type !== "agent" || (actor.writableStatuses ?? actor.allowedStatuses).includes(status);
}
export function canAgentEditDraft(actor: Pick<RequestActor,"type"|"ownerId">, doc:Pick<KnowledgeDocument,"source"|"status"|"owner_id">) {
  return actor.type!=="agent" || (["mcp","obsidian_vault"].includes(doc.source)&&doc.status==="draft"&&doc.owner_id===actor.ownerId);
}

export function canReadKnowledgeDocument(actor: DocumentActor, document: ReadableDocument) {
  // Coarse status gate; hydrated category/meeting/ancestor checks follow in
  // readableKnowledgePages before any response leaves the server.
  return canReadDocument(actor, { owner_id: document.owner_id, status: document.status, source: document.source });
}
