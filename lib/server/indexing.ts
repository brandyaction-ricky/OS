import { createHash } from "node:crypto";
import { chunkMarkdown } from "@/lib/chunking";
import { hasServerSupabaseConfig } from "@/lib/config";
import { createServiceSupabase } from "@/lib/supabase/server";
import { createEmbeddings, toPgVector } from "./embeddings";

export interface EmbeddingQueueSummary {
  pending: number;
  running: number;
  failed: number;
  done: number;
}

export interface EmbeddingBatchResult {
  attempted: number;
  completed: number;
  failed: number;
  remaining: number;
  stoppedByDeadline: boolean;
}

const EMPTY_SUMMARY: EmbeddingQueueSummary = { pending: 0, running: 0, failed: 0, done: 0 };

export async function getEmbeddingQueueSummary(): Promise<EmbeddingQueueSummary> {
  if (!hasServerSupabaseConfig()) return EMPTY_SUMMARY;
  const supabase = createServiceSupabase();
  const entries = await Promise.all((["pending", "running", "failed", "done"] as const).map(async (status) => {
    const { count, error } = await supabase.from("os_embedding_jobs").select("id", { count: "exact", head: true }).eq("status", status);
    if (error) throw error;
    return [status, count ?? 0] as const;
  }));
  return Object.fromEntries(entries) as unknown as EmbeddingQueueSummary;
}

async function failJob(documentId: string, contentHash: string, reason: unknown) {
  const message = reason instanceof Error ? reason.message : "알 수 없는 인덱싱 오류";
  await createServiceSupabase().from("os_embedding_jobs").update({
    status: "failed", finished_at: new Date().toISOString(), error_message: message.slice(0, 1000),
  }).eq("document_id", documentId).eq("content_hash", contentHash).eq("status", "running");
}

export async function indexDocument(documentId: string): Promise<"ready" | "queued"> {
  if (!hasServerSupabaseConfig() || !process.env.OPENAI_API_KEY) return "queued";
  const supabase = createServiceSupabase();
  const { data: document, error } = await supabase
    .from("os_documents")
    .select("id,content_md,content_hash,current_version")
    .eq("id", documentId)
    .single();
  if (error || !document) return "queued";

  const chunks = chunkMarkdown(document.content_md);
  if (!chunks.length) return "queued";
  const contentHash = document.content_hash || createHash("sha256").update(document.content_md).digest("hex");

  await supabase.from("os_embedding_jobs").update({
    status: "failed", finished_at: new Date().toISOString(), error_message: "새 문서 버전으로 대체된 작업입니다.",
  }).eq("document_id", documentId).eq("status", "pending").neq("content_hash", contentHash);

  const { data: claimed, error: claimError } = await supabase
    .from("os_embedding_jobs")
    .update({ status: "running", started_at: new Date().toISOString(), error_message: null })
    .eq("document_id", documentId)
    .eq("content_hash", contentHash)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return "queued";

  try {
    const vectors: number[][] = [];
    for (let offset = 0; offset < chunks.length; offset += 16) {
      vectors.push(...(await createEmbeddings(chunks.slice(offset, offset + 16).map((chunk) => chunk.text), 20_000)));
    }
    const { data: previousChunks, error: snapshotError } = await supabase.from("os_document_chunks")
      .select("document_id,chunk_index,chunk_text,heading_path,token_count,embedding,embedding_model,content_hash,meta")
      .eq("document_id", documentId);
    if (snapshotError) throw snapshotError;
    const { error: deleteError } = await supabase.from("os_document_chunks").delete().eq("document_id", documentId);
    if (deleteError) throw deleteError;
    const { error: insertError } = await supabase.from("os_document_chunks").insert(
      chunks.map((chunk, index) => ({
        document_id: documentId,
        chunk_index: chunk.index,
        chunk_text: chunk.text,
        heading_path: chunk.heading,
        token_count: Math.ceil(chunk.text.length / 3.4),
        embedding: toPgVector(vectors[index]),
        embedding_model: "text-embedding-3-small",
        content_hash: contentHash,
        meta: { version: document.current_version },
      })),
    );
    if (insertError) {
      if (previousChunks?.length) await supabase.from("os_document_chunks").insert(previousChunks);
      throw insertError;
    }
    await supabase
      .from("os_embedding_jobs")
      .update({ status: "done", finished_at: new Date().toISOString(), error_message: null })
      .eq("id", claimed.id)
      .eq("status", "running");
    return "ready";
  } catch (error) {
    await failJob(documentId, contentHash, error);
    throw error;
  }
}

export async function processEmbeddingQueue(options: { limit?: number; deadlineMs?: number } = {}): Promise<EmbeddingBatchResult> {
  if (!hasServerSupabaseConfig() || !process.env.OPENAI_API_KEY) {
    const summary = await getEmbeddingQueueSummary();
    return { attempted: 0, completed: 0, failed: 0, remaining: summary.pending, stoppedByDeadline: false };
  }
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const deadline = Date.now() + Math.min(Math.max(options.deadlineMs ?? 240_000, 5_000), 260_000);
  const supabase = createServiceSupabase();
  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  await supabase.from("os_embedding_jobs").update({
    status: "pending", started_at: null, finished_at: null, error_message: "중단된 실행을 자동 복구했습니다.",
  }).eq("status", "running").lt("started_at", staleBefore);
  const { data: jobs, error } = await supabase.from("os_embedding_jobs")
    .select("document_id")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  let attempted = 0, completed = 0, failed = 0;
  for (const job of jobs ?? []) {
    if (Date.now() >= deadline) break;
    attempted += 1;
    try {
      if (await indexDocument(job.document_id as string) === "ready") completed += 1;
    } catch (reason) {
      console.error("embedding queue job failed", job.document_id, reason);
      failed += 1;
    }
  }
  const summary = await getEmbeddingQueueSummary();
  return { attempted, completed, failed, remaining: summary.pending, stoppedByDeadline: attempted < (jobs?.length ?? 0) };
}

export async function retryFailedEmbeddingJobs(limit = 100) {
  const safeLimit = Math.min(Math.max(limit, 1), 500);
  const supabase = createServiceSupabase();
  const { data: jobs, error } = await supabase.from("os_embedding_jobs").select("id").eq("status", "failed").order("finished_at", { ascending: true }).limit(safeLimit);
  if (error) throw error;
  const ids = (jobs ?? []).map((job) => job.id);
  if (!ids.length) return 0;
  const { error: updateError } = await supabase.from("os_embedding_jobs").update({ status: "pending", started_at: null, finished_at: null, error_message: null }).in("id", ids).eq("status", "failed");
  if (updateError) throw updateError;
  return ids.length;
}
