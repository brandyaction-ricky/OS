import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { productFactRows } from "@/lib/youtube-process/product-facts";
import type { RequestActor } from "./auth";
import { ypUuid } from "./youtube-process-stages";

const registryId = () => ypUuid("yp-production-product-facts");

async function assigned() {
  const { data, error } = await createServiceSupabase().from("os_records").select("version,metadata").eq("id", registryId()).maybeSingle();
  if (error) throw new ApiError(503, "CANON_REGISTRY_UNAVAILABLE", "제작 정본 등록부를 불러오지 못했어요.");
  return { version: Number(data?.version ?? 0), documentId: String(data?.metadata?.documentId ?? "") };
}

/** Shared generation jobs may use an explicitly assigned company-wide canon only. */
async function source(documentId: string) {
  if (!documentId) return null;
  const db = createServiceSupabase();
  const { data, error } = await db.from("os_documents").select("id,title,current_version,content_md,steward_id").eq("id", documentId)
    .eq("status", "canonical").eq("reader_scope", "all").eq("owner_only", false).is("meeting_record_id", null).maybeSingle();
  if (error) throw new ApiError(503, "PRODUCT_FACTS_UNAVAILABLE", "상품 사실 정본을 열지 못했어요.");
  if (!data?.steward_id) return null;
  const { data: person, error: profileError } = await db.from("os_profiles").select("display_name").eq("id", data.steward_id).eq("is_active", true).maybeSingle();
  if (profileError) throw new ApiError(503, "PRODUCT_STEWARD_UNAVAILABLE", "상품 사실 정본 담당자를 확인할 수 없어요.");
  const facts = productFactRows(String(data.content_md));
  if (!person || !facts.length) return null;
  return { ref: { id: String(data.id), title: String(data.title), version: Number(data.current_version) }, steward: String(person.display_name || "담당자"), facts };
}

export async function productRegistry() {
  const slot = await assigned();
  const doc = await source(slot.documentId);
  return { version: slot.version, ref: doc?.ref ?? null, steward: doc?.steward ?? "", count: doc?.facts.length ?? 0 };
}

export async function productJobFacts() {
  const doc = await source((await assigned()).documentId);
  if (!doc) throw new ApiError(409, "PRODUCT_FACTS_REQUIRED", "상품 사실 정본과 담당자가 필요해요. 제작 정본 현황에서 등록한 뒤 다시 요청해 주세요.");
  return { ref: doc.ref, text: `상품 사실의 유일한 승인 자료 (doc_id: ${doc.ref.id}, 문서 v${doc.ref.version})\n${JSON.stringify(doc.facts)}\n입력에 해당하는 상품만 사용합니다. 확인할 수 없는 가격·무료 제공·소요 시간은 추측하지 않습니다.` };
}

export async function assignProductCanon(actor: RequestActor, documentId: string, expectedVersion: number) {
  if (actor.type !== "user" || actor.role !== "admin") throw new ApiError(403, "CANON_ADMIN_REQUIRED", "관리자가 제작 정본을 배정할 수 있어요.");
  if (!await source(documentId)) throw new ApiError(422, "PRODUCT_CANON_INVALID", "전체 공개된 회사 정본에 활성 담당자와 상품 사실 표를 확인해 주세요. 각 상품에 근거 주소와 확인일이 필요해요.");
  const db = createServiceSupabase(), metadata = { packageKind: "yp_production_product_facts", documentId };
  const query = expectedVersion ? db.from("os_records").update({ metadata, updated_by: actor.id }).eq("id", registryId()).eq("version", expectedVersion)
    : db.from("os_records").insert({ id: registryId(), record_type: "content_package", title: "제작 상품 사실 정본", status: "active", priority: "normal", owner_id: actor.ownerId, created_by: actor.id, updated_by: actor.id, team: actor.team, metadata });
  const { data, error } = await query.select("version").maybeSingle();
  if (error?.code === "23505" || (!error && !data)) throw new ApiError(409, "CANON_REGISTRY_CONFLICT", "등록부가 바뀌었어요. 새로 불러와 주세요.");
  if (error) throw new ApiError(500, "CANON_REGISTRY_FAILED", "상품 정본 연결을 저장하지 못했어요.");
  return productRegistry();
}
