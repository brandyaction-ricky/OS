import { ApiError } from "@/lib/http";
import { KNOWLEDGE_ATTACHMENT_BUCKET } from "@/lib/knowledge-attachments";
import { createServiceSupabase } from "@/lib/supabase/server";

const DEFAULT_PENDING_AGE_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_RETRY_AGE_MS = 60 * 60 * 1_000;
const DEFAULT_CLEANUP_LIMIT = 100;

export async function registerPendingKnowledgeAttachment(input: { path: string; documentId: string; uploaderId: string }) {
  const { error } = await createServiceSupabase().from("os_knowledge_attachment_uploads").insert({
    path: input.path,
    encoded_path: encodeURIComponent(input.path),
    document_id: input.documentId,
    uploader_id: input.uploaderId,
    status: "pending",
  });
  if (error) throw new ApiError(500, "KNOWLEDGE_ATTACHMENT_TRACK_FAILED", "자료 정리 정보를 준비하지 못했습니다.");
}

export async function forgetKnowledgeAttachment(path: string) {
  const { error } = await createServiceSupabase().from("os_knowledge_attachment_uploads").delete().eq("path", path);
  if (error) throw new ApiError(500, "KNOWLEDGE_ATTACHMENT_TRACK_DELETE_FAILED", "자료 정리 정보를 지우지 못했습니다.");
}

export async function claimPendingKnowledgeAttachment(path: string) {
  const { data, error } = await createServiceSupabase()
    .from("os_knowledge_attachment_uploads")
    .update({ status: "deleting", last_cleanup_attempt_at: new Date().toISOString() })
    .eq("path", path)
    .eq("status", "pending")
    .select("path")
    .maybeSingle();
  if (error) throw new ApiError(500, "KNOWLEDGE_ATTACHMENT_CLAIM_FAILED", "자료 정리를 준비하지 못했습니다.");
  if (!data) throw new ApiError(409, "KNOWLEDGE_ATTACHMENT_IN_USE", "이미 저장된 첨부 자료는 이 화면에서 삭제할 수 없습니다.");
}

export async function cleanupPendingKnowledgeAttachments(options: { now?: Date; olderThanMs?: number; limit?: number } = {}) {
  const now = options.now ?? new Date();
  const olderThanMs = options.olderThanMs ?? DEFAULT_PENDING_AGE_MS;
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_CLEANUP_LIMIT, 1), 1_000);
  const supabase = createServiceSupabase();
  const cutoff = new Date(now.getTime() - olderThanMs).toISOString();
  const retryBefore = new Date(now.getTime() - DEFAULT_RETRY_AGE_MS).toISOString();
  const { data, error } = await supabase.rpc("os_claim_stale_knowledge_attachments", {
    p_cutoff: cutoff,
    p_retry_before: retryBefore,
    p_limit: limit,
  });
  if (error) throw new ApiError(500, "KNOWLEDGE_ATTACHMENT_CLEANUP_READ_FAILED", "정리할 자료를 확인하지 못했습니다.");
  const paths = (data ?? []).map((row: { path: string }) => row.path);
  if (!paths.length) return { eligible: 0, deleted: 0 };

  const { error: removeError } = await supabase.storage.from(KNOWLEDGE_ATTACHMENT_BUCKET).remove(paths);
  if (removeError) {
    throw new ApiError(502, "KNOWLEDGE_ATTACHMENT_CLEANUP_STORAGE_FAILED", "사용하지 않은 자료를 정리하지 못했습니다.");
  }
  const { error: deleteError } = await supabase.from("os_knowledge_attachment_uploads").delete().in("path", paths).eq("status", "deleting");
  if (deleteError) throw new ApiError(500, "KNOWLEDGE_ATTACHMENT_CLEANUP_RECEIPT_FAILED", "자료는 정리했지만 정리 기록을 마치지 못했습니다.");
  return { eligible: paths.length, deleted: paths.length };
}
