import type { DocumentStatus, KnowledgeDocument } from "@/lib/types";
import type { RequestActor } from "./auth";

type ReadableDocument = Pick<KnowledgeDocument, "owner_id" | "status">;
type DocumentActor = Pick<RequestActor, "allowedStatuses" | "ownerId" | "role" | "type">;

export function agentReadableStatuses(configured: DocumentStatus[], canWrite = false) {
  // A draft-writing key still reads company reference documents; write checks use the raw policy.
  return [...new Set([...configured, "team" as const, ...(canWrite ? ["canonical" as const] : [])])];
}
export function canAgentWriteDocument(actor: Pick<RequestActor, "type" | "allowedStatuses" | "writableStatuses">, status: DocumentStatus) {
  return actor.type !== "agent" || (actor.writableStatuses ?? actor.allowedStatuses).includes(status);
}

export function canReadKnowledgeDocument(actor: DocumentActor, document: ReadableDocument) {
  if (actor.role === "admin" || document.owner_id === actor.ownerId) return true;
  if (document.status === "archived" || document.status === "draft") return false;
  if (actor.type === "agent") {
    if (!actor.allowedStatuses.includes(document.status)) return false;
    return document.status === "team" || document.status === "canonical";
  }
  return ["team", "review", "reviewed", "canonical"].includes(document.status);
}
