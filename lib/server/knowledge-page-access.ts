import type { KnowledgeDocument } from "@/lib/types";
import type { RequestActor } from "./auth";
import { canReadKnowledgeDocument } from "./document-access";
import { createServiceSupabase } from "@/lib/supabase/server";

type PageAccessRow = Pick<KnowledgeDocument, "id" | "owner_id" | "status"> & { parent_document_id?: string | null };

// A child's own status is not enough: a team-visible child beneath a private
// draft must not reveal its parent's hierarchy or content by direct URL.
export async function readableKnowledgePages(actor: RequestActor, rows: PageAccessRow[]) {
  const byId = new Map(rows.map(row => [row.id, row]));
  let pending = [...new Set(rows.map(row => row.parent_document_id).filter((id): id is string => Boolean(id)))];
  for (let depth = 0; pending.length && depth < 64; depth += 1) {
    const missing = pending.filter(id => !byId.has(id));
    if (!missing.length) break;
    const { data, error } = await createServiceSupabase().from("os_documents")
      .select("id,parent_document_id,owner_id,status").in("id", missing);
    if (error) throw error;
    for (const row of data ?? []) byId.set(row.id, row);
    pending = [...new Set((data ?? []).map(row => row.parent_document_id).filter((id): id is string => Boolean(id)))];
  }
  const readable = (row: PageAccessRow) => {
    const visited = new Set<string>();
    let current: PageAccessRow | undefined = row;
    for (let depth = 0; current && depth < 64; depth += 1) {
      if (visited.has(current.id) || !canReadKnowledgeDocument(actor, current)) return false;
      visited.add(current.id);
      if (!current.parent_document_id) return true;
      current = byId.get(current.parent_document_id);
    }
    return false;
  };
  return new Set(rows.filter(readable).map(row => row.id));
}
