import type { KnowledgeDocument } from "@/lib/types";
import type { RequestActor } from "./auth";
import { canReadDocument, knowledgeAccessContext } from "./knowledge-access";
import { createServiceSupabase } from "@/lib/supabase/server";

type PageAccessRow = Pick<KnowledgeDocument, "id" | "owner_id" | "status"> & { parent_document_id?: string | null };
export const POLICY_FIELDS="id,owner_id,status,parent_document_id,category_id,meeting_record_id,archived_from_status,archived_by,source,reader_scope,steward_id";
const policyKeys=POLICY_FIELDS.split(",");

// A child's own status is not enough: a team-visible child beneath a private
// draft must not reveal its parent's hierarchy or content by direct URL.
export async function readableKnowledgePages(actor: RequestActor, rows: PageAccessRow[]) {
  if (!rows.length) return new Set<string>();
  // Complete server-side database projections already carry every policy field.
  // Partial summaries still need hydration: missing fields must never grant access.
  const complete = (row: PageAccessRow) => policyKeys.every(key => Object.hasOwn(row, key));
  const hydrated: PageAccessRow[] = rows.filter(complete);
  const incomplete = rows.filter(row => !complete(row));
  for (let offset = 0; offset < incomplete.length; offset += 800) {
    const chunks = [0, 200, 400, 600].map(start => incomplete.slice(offset + start, offset + start + 200)).filter(chunk => chunk.length);
    const results = await Promise.all(chunks.map(chunk => createServiceSupabase().from("os_documents").select(POLICY_FIELDS).in("id", chunk.map(row => row.id))));
    for (const result of results) {
      if (result.error) throw result.error;
      hydrated.push(...(result.data ?? []));
    }
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
  const access = await knowledgeAccessContext(actor, [...byId.values()]);
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
