import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiError } from "@/lib/http";

export async function assertSkillSource(supabase: SupabaseClient, type: string, metadata?: Record<string, unknown>, previous?: Record<string, unknown>) {
  if (type !== "skill" || !metadata || !("sourceDocumentId" in metadata) || metadata.sourceDocumentId === previous?.sourceDocumentId) return;
  const id = metadata.sourceDocumentId;
  if (id === null || id === "") return;
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, "INVALID_SKILL_SOURCE", "연결할 지식 문서를 다시 선택해 주세요.");
  const {data, error} = await supabase.from("os_documents").select("id,status").eq("id", id).maybeSingle();
  if (error || !data || data.status === "archived") throw new ApiError(400, "SKILL_SOURCE_UNAVAILABLE", "연결할 지식 문서를 확인할 수 없습니다. 활성 문서를 선택해 주세요.");
}
