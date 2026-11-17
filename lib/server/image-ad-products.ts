import { ApiError } from "@/lib/http";
import { imageAdProductsFromCanon, withImageProductChoices, IMAGE_PRODUCT_CANON_TITLES, IMAGE_PRODUCT_OPERATING_TITLES } from "@/lib/image-creative/products";
import type { KnowledgeDocument } from "@/lib/types";
import type { RequestActor } from "./auth";
import { POLICY_FIELDS, readableKnowledgePages } from "./knowledge-page-access";

const unavailable = () => new ApiError(503,"IMAGE_PRODUCT_CANON_UNAVAILABLE","상품 정본을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.");

export async function readImageAdProducts(actor: RequestActor) {
  const docs = actor.supabase.from("os_documents");
  const {data,error} = await docs.select(`${POLICY_FIELDS},current_version`)
    .eq("status","canonical").in("title",IMAGE_PRODUCT_CANON_TITLES).is("archived_at",null);
  if (error) throw unavailable();
  const operating = await docs.select(`${POLICY_FIELDS},current_version`).in("status",["canonical","team"]).in("title",IMAGE_PRODUCT_OPERATING_TITLES).is("archived_at",null);
  if (operating.error) throw unavailable();
  const rows = [...new Map([...(data ?? []),...(operating.data ?? [])].map(row=>[row.id,row])).values()] as unknown as KnowledgeDocument[];
  const visible = await readableKnowledgePages(actor, rows);
  if (!visible.size) return withImageProductChoices([]);
  // Direct row visibility alone doesn't guarantee the employee may read a child document.
  const bodies = await docs.select("id,title,status,current_version,content_md").in("status",["canonical","team"]).in("id",[...visible]).is("archived_at",null);
  if (bodies.error) throw unavailable();
  const current = bodies.data ?? [];
  if (current.some(doc => !rows.some(row => row.id===doc.id && row.current_version===doc.current_version))) throw unavailable();
  return withImageProductChoices(imageAdProductsFromCanon(current));
}
