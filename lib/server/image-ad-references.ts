import { ApiError } from "@/lib/http";
import { WAREHOUSE_INDEX_TITLE, referenceCatalogFromDocs, warehouseChapterIds } from "@/lib/image-creative/reference-canon";
import type { KnowledgeDocument } from "@/lib/types";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { RequestActor } from "./auth";
import { POLICY_FIELDS, readableKnowledgePages } from "./knowledge-page-access";

const unavailable = () => new ApiError(503, "IMAGE_REFERENCES_UNAVAILABLE", "포맷 창고 원문을 확인하지 못했습니다.");

export async function readImageAdReferences(actor: RequestActor) {
  const docs = createServiceSupabase().from("os_documents");
  async function visibleDocuments(field: "id" | "title", values: string[]) {
    const result = await docs.select(`${POLICY_FIELDS},current_version`).neq("status", "archived").in(field,values);
    if (result.error) throw unavailable();
    const rows = (result.data ?? []) as unknown as KnowledgeDocument[];
    const visible = await readableKnowledgePages(actor, rows);
    if (!visible.size) return [];
    // Read bodies only after checking the actor's grants, including all parent pages.
    const bodies = await docs.select("id,title,content_md,current_version").neq("status", "archived").in("id", [...visible]);
    if (bodies.error || bodies.data?.some(doc => !rows.some(row => row.id === doc.id && row.current_version === doc.current_version))) throw unavailable();
    return bodies.data ?? [];
  }
  const indexId = process.env.IMAGE_AD_WAREHOUSE_DOC;
  const selected = await visibleDocuments(indexId ? "id" : "title", [indexId || WAREHOUSE_INDEX_TITLE]);
  if (selected.length !== 1) throw unavailable();
  const ids = warehouseChapterIds(selected[0].content_md);
  if (!ids.length) return {entries: []};
  const chapters = await visibleDocuments("id", ids);
  const byId = new Map(chapters.map(row => [row.id, row]));
  return referenceCatalogFromDocs(ids.flatMap(id => byId.get(id) ?? []));
}
