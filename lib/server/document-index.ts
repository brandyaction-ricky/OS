import { ApiError } from "@/lib/http";
import type { KnowledgeDocument } from "@/lib/types";
import type { RequestActor } from "./auth";
import { POLICY_FIELDS, readableKnowledgePages } from "./knowledge-page-access";

// Only lightweight metadata crosses this boundary. Bodies are fetched on open.
// Folder counts need only the folder and the access fields, not every listed column.
export async function documentIndex(scope: string, actor: RequestActor, view: "list" | "folders" = "list") {
  const columns = view === "folders" ? `folder,${POLICY_FIELDS}` : `title,folder,source_ref,current_version,updated_at,team,brand,tags,${POLICY_FIELDS}`;
  const ownerId = actor.ownerId;
  const scoped = (columns: string, options?: { count: "exact"; head: true }) => {
    // A signed-in member's own client lets row policies drop unreadable drafts in the
    // database; the page check below still runs (agents keep the service client).
    let query = actor.supabase.from("os_documents").select(columns, options);
    if (scope === "mine_company") query = query.or(`owner_id.eq.${ownerId},status.eq.canonical`);
    else if (scope === "mine") query = query.eq("owner_id", ownerId);
    else if (["canonical", "team", "archived"].includes(scope)) query = query.eq("status", scope);
    else if (scope === "review") query = query.in("status", ["review", "reviewed"]);
    else if (scope.startsWith("member:")) query = query.eq("owner_id", scope.slice(7));
    if (scope !== "archived") query = query.neq("status", "archived");
    return query;
  };
  const failed = () => new ApiError(400, "DOCUMENT_INDEX_FAILED", "폴더 목록을 불러오지 못했습니다.");
  // The count fixes every page, so pages are read together instead of one after another.
  const { count, error: countError } = await scoped("id", { count: "exact", head: true });
  if (countError) throw failed();
  const offsets = Array.from({ length: Math.max(1, Math.ceil((count ?? 0) / 1000)) }, (_, page) => page * 1000);
  const pages = await Promise.all(offsets.map(offset =>
    scoped(columns).order("id").range(offset, offset + 999)));
  // Rows added after the count still arrive: a full last page continues one page at a time.
  for (let offset = offsets[offsets.length - 1] + 1000; pages[pages.length - 1].data?.length === 1000; offset += 1000) {
    pages.push(await scoped(columns).order("id").range(offset, offset + 999));
  }
  const rows: KnowledgeDocument[] = [];
  for (const { data, error } of pages) {
    if (error) throw failed();
    rows.push(...(data ?? []) as unknown as KnowledgeDocument[]);
  }
  const readable = await readableKnowledgePages(actor, rows);
  return rows.filter(row => readable.has(row.id));
}
