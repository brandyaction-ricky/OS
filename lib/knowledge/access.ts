/** One policy for lists, counts, search, links and detail views. Never infer access from role alone. */
export interface KnowledgeActor {
  ownerId: string;
  type: "user" | "agent";
  role: string;
  memberKind?: "staff" | "partner";
  active?: boolean;
  allowedStatuses: readonly string[];
  canApprove?: boolean;
}
export interface AccessDocument {
  id?: string;
  owner_id: string;
  status: string;
  source?: string;
  category_id?: string | null;
  meeting_record_id?: string | null;
  archived_from_status?: string | null;
  archived_by?: string | null;
}
export interface KnowledgeAccessContext {
  categories?: ReadonlyMap<string, { partner_ids: readonly string[]; archived_at?: string | null }>;
  meetings?: ReadonlyMap<string, { visibility: string; attendees: readonly string[] }>;
  noteGrants?: ReadonlySet<string>;
}
export function canReadDocument(actor: KnowledgeActor, doc: AccessDocument, context: KnowledgeAccessContext = {}) {
  if (actor.active === false) return false;
  const status = doc.status === "archived" ? doc.archived_from_status ?? "draft" : doc.status;
  if(actor.memberKind==="partner"&&doc.source==="mcp"&&status!=="canonical")return false;
  // Meeting privacy must survive every document state, including Trash.
  if (doc.meeting_record_id) {
    const meeting = context.meetings?.get(doc.meeting_record_id);
    if (!meeting || actor.type !== "user") return false;
    if (!meeting.attendees.includes(actor.ownerId) && !(actor.memberKind !== "partner" && meeting.visibility === "team")) return false;
  }
  if (status === "draft") {
    // AI keys can read their owner's AI-generated work, not that owner's human
    // notes or imported vault. Archived drafts remain unavailable to agents.
    if (actor.type === "agent") return doc.status === "draft" && doc.source === "mcp"
      && doc.owner_id === actor.ownerId && actor.allowedStatuses.includes("draft");
    return doc.owner_id === actor.ownerId || Boolean(actor.role === "admin" && doc.id && context.noteGrants?.has(doc.id));
  }
  if (doc.status === "archived") return actor.type === "user" && (actor.role === "admin" || doc.owner_id === actor.ownerId || doc.archived_by === actor.ownerId);
  if (doc.meeting_record_id) return true;
  if (actor.type === "agent") return actor.allowedStatuses.includes(doc.status) && ["team", "canonical"].includes(doc.status);
  if (doc.status === "canonical") return true;
  if (!["team", "review", "reviewed"].includes(doc.status)) return false;
  if (actor.memberKind !== "partner") return true;
  if (doc.source === "mcp") return false;
  if (doc.owner_id === actor.ownerId) return true;
  const category = doc.category_id ? context.categories?.get(doc.category_id) : undefined;
  return Boolean(category && !category.archived_at && category.partner_ids.includes(actor.ownerId));
}
export function filterReadable<T extends AccessDocument>(actor: KnowledgeActor, docs: T[], context?: KnowledgeAccessContext): T[] {
  return docs.filter(doc => canReadDocument(actor, doc, context));
}
export function canReadDocumentTree(actor:KnowledgeActor,doc:AccessDocument&{parent_document_id?:string|null},docs:ReadonlyMap<string,AccessDocument&{parent_document_id?:string|null}>,context?:KnowledgeAccessContext){
  const visited=new Set<string>();let current:typeof doc|undefined=doc;
  for(let depth=0;current&&depth<64;depth++){
    if(!current.id||visited.has(current.id)||!canReadDocument(actor,current,context))return false;
    visited.add(current.id);
    if(!current.parent_document_id)return true;
    current=docs.get(current.parent_document_id);
  }
  return false;
}
export function canEditDocument(actor: KnowledgeActor, doc: AccessDocument, context?: KnowledgeAccessContext) {
  return actor.type === "user" && !doc.meeting_record_id && doc.status !== "canonical" && doc.status !== "archived" && (doc.status !== "draft" || doc.owner_id === actor.ownerId) && canReadDocument(actor, doc, context);
}
export function canChangeCategory(actor: KnowledgeActor, doc: AccessDocument, context?: KnowledgeAccessContext) {
  return actor.type === "user" && actor.memberKind !== "partner" && !doc.meeting_record_id && canEditDocument(actor, doc, context);
}
export function canManageCategory(actor: KnowledgeActor, category: { space: string; owner_id?: string | null }, destructive = false) {
  if (actor.type !== "user" || actor.active === false) return false;
  if (category.space === "mine") return category.owner_id === actor.ownerId;
  return actor.memberKind !== "partner" && (!destructive || actor.role === "admin");
}
export function canDecideProposal(actor: KnowledgeActor, proposal: { author_id: string; requested_approver_id?: string | null; agent_owner_id?: string | null }, doc: AccessDocument, proxyReason = "") {
  return actor.type === "user" && actor.memberKind !== "partner" && actor.active !== false && actor.canApprove === true
    && ![proposal.author_id, proposal.agent_owner_id, doc.owner_id].includes(actor.ownerId)
    && (!proposal.requested_approver_id || proposal.requested_approver_id === actor.ownerId || (actor.role === "admin" && proxyReason.trim().length > 0));
}
