import { ApiError } from "@/lib/http";
import type { KnowledgeDocument } from "@/lib/types";
import type { RequestActor } from "./auth";
import { POLICY_FIELDS, readableKnowledgePages } from "./knowledge-page-access";

// Only lightweight metadata crosses this boundary. Bodies are fetched on open.
// Folder counts need only the folder and the access fields, not every listed column.
export async function documentIndex(scope: string, actor: RequestActor, view: "list" | "folders" = "list") {
  const columns = view === "folders" ? `folder,${POLICY_FIELDS}` : `title,folder,source_ref,current_version,updated_at,team,brand,tags,${POLICY_FIELDS}`;
  const ownerId = actor.ownerId;
  const scoped = (columns: string) => {
    // A signed-in member's own client lets row policies drop unreadable drafts in the
    // database; the page check below still runs (agents keep the service client).
    let query = actor.supabase.from("os_documents").select(columns);
    if (scope === "mine_company") query = query.or(`owner_id.eq.${ownerId},status.eq.canonical`);
    else if (scope === "mine") query = query.eq("owner_id", ownerId);
    else if (["canonical", "team", "archived"].includes(scope)) query = query.eq("status", scope);
    else if (scope === "review") query = query.in("status", ["review", "reviewed"]);
    else if (scope.startsWith("member:")) query = query.eq("owner_id", scope.slice(7));
    if (scope !== "archived") query = query.neq("status", "archived");
    return query;
  };
  const failed = () => new ApiError(400, "DOCUMENT_INDEX_FAILED", "폴더 목록을 불러오지 못했습니다.");
  // An exact count repeats every row-policy check; OFFSET revisits preceding rows.
  // Walk the primary key once, with one request in flight, retaining the same RLS.
  const rows: KnowledgeDocument[] = [];
  let cursor: string | undefined;
  for (;;) {
    let query = scoped(columns).order("id").limit(1000);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error) throw failed();
    const batch = (data ?? []) as unknown as KnowledgeDocument[];
    rows.push(...batch);
    if (batch.length < 1000) break;
    const next = batch[batch.length - 1].id;
    if (!next || (cursor && next <= cursor)) throw failed();
    cursor = next;
  }
  const readable = await readableKnowledgePages(actor, rows);
  return rows.filter(row => readable.has(row.id));
}
