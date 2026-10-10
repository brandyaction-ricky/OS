import type { KnowledgeDocument } from "@/lib/types";
import type { RequestActor } from "./auth";
import { canReadDocument, knowledgeAccessContext } from "./knowledge-access";
import { createServiceSupabase } from "@/lib/supabase/server";

type PageAccessRow = Pick<KnowledgeDocument, "id" | "owner_id" | "status"> & { parent_document_id?: string | null };
const POLICY_FIELDS="id,owner_id,status,parent_document_id,category_id,meeting_record_id,archived_from_status,archived_by,source";

// A child's own status is not enough: a team-visible child beneath a private
// draft must not reveal its parent's hierarchy or content by direct URL.
export async function readableKnowledgePages(actor: RequestActor, rows: PageAccessRow[], options: { allowAgentPrivateGrant?: boolean } = {}) {
  if (!rows.length) return new Set<string>();
  // Callers may pass summaries without category/meeting/private-archive metadata.
  // Re-fetch the policy projection so a missing field cannot turn into access.
  const hydrated: PageAccessRow[] = [];
  for (let offset = 0; offset < rows.length; offset += 200) {
    const result = await createServiceSupabase().from("os_documents").select(POLICY_FIELDS).in("id", rows.slice(offset, offset + 200).map(row => row.id));
    if (result.error) throw result.error;
    hydrated.push(...(result.data ?? []));
  }
  const byId = new Map(hydrated.map(row => [row.id, row]));
  let pending = [...new Set(hydrated.map(row => row.parent_document_id).filter((id): id is string => Boolean(id)))];
  for (let depth = 0; pending.length && depth < 64; depth += 1) {
    const missing = pending.filter(id => !byId.has(id));
    if (!missing.length) break;
    const parents:PageAccessRow[]=[];
    for(let offset=0;offset<missing.length;offset+=200){
      const {data,error}=await createServiceSupabase().from("os_documents").select(POLICY_FIELDS).in("id",missing.slice(offset,offset+200));
      if(error)throw error;
      parents.push(...(data??[]));
    }
    for (const row of parents) byId.set(row.id, row);
    pending = [...new Set(parents.map(row => row.parent_document_id).filter((id): id is string => Boolean(id)))];
  }
  const access = await knowledgeAccessContext(actor, [...byId.values()], options.allowAgentPrivateGrant === true);
  const readable = (row: PageAccessRow) => {
    const visited = new Set<string>();
    let current: PageAccessRow | undefined = byId.get(row.id);
    for (let depth = 0; current && depth < 64; depth += 1) {
      if (visited.has(current.id) || !canReadDocument(access.actor, current, access.context)) return false;
      visited.add(current.id);
      if (!current.parent_document_id) return true;
      current = byId.get(current.parent_document_id);
    }
    return false;
  };
  return new Set(rows.filter(readable).map(row => row.id));
}
