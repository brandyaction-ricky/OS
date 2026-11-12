import { ApiError } from "@/lib/http";
import { imageAdProductsFromCanon, IMAGE_PRODUCT_CANON_TITLES } from "@/lib/image-creative/products";
import type { KnowledgeDocument } from "@/lib/types";
import type { RequestActor } from "./auth";
import { POLICY_FIELDS, readableKnowledgePages } from "./knowledge-page-access";

const unavailable = () => new ApiError(503,"IMAGE_PRODUCT_CANON_UNAVAILABLE","상품 정본을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.");

export async function readImageAdProducts(actor: RequestActor) {
  const docs = actor.supabase.from("os_documents");
  const {data,error} = await docs.select(`${POLICY_FIELDS},current_version`)
    .eq("status","canonical").in("title",IMAGE_PRODUCT_CANON_TITLES);
  if (error) throw unavailable();
  const rows = (data ?? []) as unknown as KnowledgeDocument[];
  const visible = await readableKnowledgePages(actor, rows);
  if (!visible.size) return [];
  // Direct row visibility alone doesn't guarantee the employee may read a child document.
  const bodies = await docs.select("id,title,status,current_version,content_md").eq("status","canonical").in("id",[...visible]);
  if (bodies.error) throw unavailable();
  const current = bodies.data ?? [];
  if (current.some(doc => !rows.some(row => row.id===doc.id && row.current_version===doc.current_version))) throw unavailable();
  return imageAdProductsFromCanon(current);
}
