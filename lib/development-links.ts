import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiError } from "./http";
import { isDevelopmentRequest } from "./development-requests";
import type { RecordType } from "./record-types";

const developmentHistoryTypes = new Set<RecordType>(["development_log", "deployment"]);

export function linkedDevelopmentRequestId(metadata: Record<string, unknown> | null | undefined) {
  const value = metadata?.requestId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function assertDevelopmentRequestLink(
  service: Pick<SupabaseClient, "from">,
  input: { recordType: RecordType; parentId?: string | null; metadata?: Record<string, unknown> | null },
) {
  if (!developmentHistoryTypes.has(input.recordType)) return;
  const requestId = linkedDevelopmentRequestId(input.metadata);
  if (!requestId) return;
  if (!z.string().uuid().safeParse(requestId).success) {
    throw new ApiError(400, "INVALID_DEVELOPMENT_REQUEST_LINK", "연결할 개발 요청 ID를 확인해 주세요.");
  }
  if (!input.parentId) {
    throw new ApiError(400, "DEVELOPMENT_PROJECT_REQUIRED", "요청과 연결할 개발 프로젝트가 필요합니다.");
  }

  const { data: request, error } = await service
    .from("os_records")
    .select("id,parent_id,record_type,metadata")
    .eq("id", requestId)
    .is("archived_at", null)
    .maybeSingle();
  if (error || !request || !isDevelopmentRequest(request)) {
    throw new ApiError(404, "DEVELOPMENT_REQUEST_NOT_FOUND", "연결할 개발 요청을 찾지 못했습니다.", error?.message);
  }
  if (request.parent_id !== input.parentId) {
    throw new ApiError(409, "DEVELOPMENT_REQUEST_PROJECT_MISMATCH", "개발 요청과 작업 기록의 프로젝트가 다릅니다.");
  }
}
