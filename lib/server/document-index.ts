import { createServiceSupabase } from "@/lib/supabase/server";
import { ApiError } from "@/lib/http";
import type { KnowledgeDocument } from "@/lib/types";

// Only lightweight metadata crosses this boundary. Bodies are fetched on open.
export async function documentIndex(scope: string, ownerId: string) {
  const rows: KnowledgeDocument[] = [];
  for (let offset = 0; ; offset += 1000) {
    let query = createServiceSupabase().from("os_documents")
      .select("id,title,folder,status,source_ref,owner_id,current_version,updated_at")
      .order("id").range(offset, offset + 999);
    if (scope === "mine_company") query = query.or(`owner_id.eq.${ownerId},status.eq.canonical`);
    else if (scope === "mine") query = query.eq("owner_id", ownerId);
    else if (["canonical", "team", "archived"].includes(scope)) query = query.eq("status", scope);
    else if (scope === "review") query = query.in("status", ["review", "reviewed"]);
    else if (scope.startsWith("member:")) query = query.eq("owner_id", scope.slice(7));
    if (scope !== "archived") query = query.neq("status", "archived");
    const { data, error } = await query;
    if (error) throw new ApiError(400, "DOCUMENT_INDEX_FAILED", "폴더 목록을 불러오지 못했습니다.");
    rows.push(...(data ?? []) as KnowledgeDocument[]);
    if (!data || data.length < 1000) break;
  }
  return rows;
}
