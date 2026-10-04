import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiError } from "@/lib/http";

export async function assertSkillSource(supabase: SupabaseClient, type: string, metadata?: Record<string, unknown>, previous?: Record<string, unknown>) {
  if (type !== "skill" || !metadata || !("sourceDocumentId" in metadata)) return;
  const extractedVersion=metadata.sourceVersion??previous?.sourceVersion;
  if(!extractedVersion&&metadata.sourceDocumentId === previous?.sourceDocumentId)return;
  const id = metadata.sourceDocumentId;
  if (id === null || id === "") return;
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, "INVALID_SKILL_SOURCE", "연결할 지식 문서를 다시 선택해 주세요.");
  const {data, error} = await supabase.from("os_documents").select("id,status,current_version").eq("id", id).maybeSingle();
  if (error || !data || data.status === "archived") throw new ApiError(400, "SKILL_SOURCE_UNAVAILABLE", "연결할 지식 문서를 확인할 수 없습니다. 활성 문서를 선택해 주세요.");
  if(extractedVersion&&(data.status!=="canonical"||data.current_version!==extractedVersion))throw new ApiError(409,"SKILL_SOURCE_CHANGED","추출 이후 원문이 바뀌었습니다. 현재 정본에서 규칙을 다시 추출해 주세요.");
}
