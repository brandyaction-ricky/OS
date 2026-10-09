import type { DocumentStatus, KnowledgeDocument } from "@/lib/types";
import type { RequestActor } from "./auth";
import { canReadDocument } from "../knowledge/access.ts";

type ReadableDocument = Pick<KnowledgeDocument, "owner_id" | "status">;
type DocumentActor = Pick<RequestActor, "allowedStatuses" | "ownerId" | "role" | "type">;

export function agentReadableStatuses(configured: DocumentStatus[], canWrite = false) {
  // A draft-writing key still reads company reference documents; write checks use the raw policy.
  return [...new Set([...configured, "team" as const, ...(canWrite ? ["canonical" as const] : [])])];
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
  return canReadDocument(actor, { owner_id: document.owner_id, status: document.status });
}
