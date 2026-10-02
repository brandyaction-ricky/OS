import { ApiError } from "@/lib/http";
import { safeIndexingFailure, classifyIndexingFailure, currentIndexJobs, type IndexCoverage } from "@/lib/indexing-diagnostics";
import { getIndexCoverage, readIndexSnapshot } from "./indexing-diagnostics";
import { chunkMarkdown } from "@/lib/chunking";
import { hasServerSupabaseConfig } from "@/lib/config";
import { createServiceSupabase } from "@/lib/supabase/server";
import { createEmbeddings, toPgVector } from "./embeddings";
export interface EmbeddingQueueSummary {
    coverage?: IndexCoverage;
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
    if (!hasServerSupabaseConfig())
        return EMPTY_SUMMARY;
    const supabase = createServiceSupabase();
    const entries = await Promise.all((["pending", "running", "failed", "done"] as const).map(async (status) => {
        const { count, error } = await supabase.from("os_embedding_jobs").select("id", { count: "exact", head: true }).eq("status", status);
        if (error)
            throw new ApiError(503, "INDEX_QUEUE_UNAVAILABLE", "색인 대기열을 확인하지 못했습니다.");
        return [status, count ?? 0] as const;
    }));
    return { ...Object.fromEntries(entries), coverage: await getIndexCoverage(supabase) } as unknown as EmbeddingQueueSummary;
}
async function failJob(documentId: string, contentHash: string, reason: unknown) {
    const message = safeIndexingFailure(reason);
    await createServiceSupabase().from("os_embedding_jobs").update({
        status: "failed", finished_at: new Date().toISOString(), last_error: message.slice(0, 1000),
    }).eq("document_id", documentId).eq("content_hash", contentHash).eq("status", "running");
}
export async function indexDocument(documentId: string): Promise<"ready" | "queued"> {
    if (!hasServerSupabaseConfig() || !process.env.OPENAI_API_KEY)
        return "queued";
    const supabase = createServiceSupabase();
    const { data: document, error } = await supabase
        .from("os_documents")
        .select("id,content_md,content_hash,current_version,status")
        .eq("id", documentId)
        .single();
    if (error || !document)
        return "queued";
    if (document.status === "archived") {
        const { error: archiveError } = await supabase.from("os_embedding_jobs").update({ status: "failed", finished_at: new Date().toISOString(), last_error: "[archived] 보관 문서" }).eq("document_id", documentId).eq("status", "pending");
        if (archiveError)
            throw new ApiError(503, "INDEX_STORAGE_ERROR", "보관 문서 작업을 정리하지 못했습니다.");
        return "queued";
    }
    const chunks = chunkMarkdown(document.content_md);
    const contentHash = document.content_hash;
    await supabase.from("os_embedding_jobs").update({
        status: "failed", finished_at: new Date().toISOString(), last_error: "새 문서 버전으로 대체된 작업입니다.",
    }).eq("document_id", documentId).eq("status", "pending").neq("content_hash", contentHash);
    const { data: claimed, error: claimError } = await supabase
        .from("os_embedding_jobs")
        .update({ status: "running", started_at: new Date().toISOString(), last_error: null })
        .eq("document_id", documentId)
        .eq("content_hash", contentHash)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
    if (claimError)
        throw new ApiError(503, "INDEX_STORAGE_ERROR", safeIndexingFailure(claimError));
    if (!claimed)
        return "queued";
    try {
        const vectors: number[][] = [];
        for (let offset = 0; offset < chunks.length; offset += 16) {
            vectors.push(...(await createEmbeddings(chunks.slice(offset, offset + 16).map((chunk) => chunk.text), 20000)));
        }
        // Existing database RPC swaps chunks and finishes the job in one transaction.
        // A failed insert rolls back the delete; a superseded hash is ignored by the RPC.
        const { error: finishError } = await supabase.rpc("os_finish_embedding_job", {
            p_job_id: claimed.id, p_error: null, p_chunks: chunks.map((chunk, index) => ({ chunk_index: chunk.index, chunk_text: chunk.text, heading_path: chunk.heading, token_count: Math.ceil(chunk.text.length / 3.4), embedding: toPgVector(vectors[index]), embedding_model: "text-embedding-3-small", meta: { version: document.current_version } })),
        });
        if (finishError)
            throw finishError;
        const { data: finished, error: finishedError } = await supabase.from("os_embedding_jobs").select("status,last_error").eq("id", claimed.id).single();
        if (finishedError)
            throw finishedError;
        if (finished?.status !== "done" || finished.last_error)
            return "queued";
        return "ready";
    }
    catch (error) {
        await failJob(documentId, contentHash, error);
        throw new ApiError(503, "INDEXING_FAILED", safeIndexingFailure(error));
    }
}
export async function processEmbeddingQueue(options: {
    limit?: number;
    deadlineMs?: number;
} = {}): Promise<EmbeddingBatchResult> {
    if (!hasServerSupabaseConfig() || !process.env.OPENAI_API_KEY) {
        const summary = await getEmbeddingQueueSummary();
        return { attempted: 0, completed: 0, failed: 0, remaining: summary.pending, stoppedByDeadline: false };
    }
    const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
    const deadline = Date.now() + Math.min(Math.max(options.deadlineMs ?? 240000, 5000), 260000);
    const supabase = createServiceSupabase();
    const staleBefore = new Date(Date.now() - 15 * 60000).toISOString();
    await supabase.from("os_embedding_jobs").update({
        status: "pending", started_at: null, finished_at: null, last_error: "중단된 실행을 자동 복구했습니다.",
    }).eq("status", "running").lt("started_at", staleBefore);
    const { data: jobs, error } = await supabase.from("os_embedding_jobs")
        .select("document_id")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(limit);
    if (error)
        throw error;
    let attempted = 0, completed = 0, failed = 0;
    for (const job of jobs ?? []) {
        if (Date.now() >= deadline)
            break;
        attempted += 1;
        try {
            if (await indexDocument(job.document_id as string) === "ready")
                completed += 1;
        }
        catch (reason) {
            console.error("embedding queue job failed", { category: classifyIndexingFailure(reason) });
            failed += 1;
        }
    }
    const summary = await getEmbeddingQueueSummary();
    return { attempted, completed, failed, remaining: summary.pending, stoppedByDeadline: attempted < (jobs?.length ?? 0) };
}
export async function retryFailedEmbeddingJobs(limit = 100) {
    const safeLimit = Math.min(Math.max(limit, 1), 500);
    const supabase = createServiceSupabase();
    const { documents, jobs, truncated } = await readIndexSnapshot(supabase, supabase);
    if (truncated)
        throw new ApiError(503, "INDEX_RETRY_SCOPE_INCOMPLETE", "재시도 범위를 모두 확인하지 못했습니다. 운영 담당자에게 확인해 주세요.");
    const eligible = [...currentIndexJobs(documents, jobs).values()].filter(job => job.status === "failed" && !["superseded", "archived"].includes(classifyIndexingFailure(job.last_error))).slice(0, safeLimit);
    let retried = 0;
    for (const job of eligible) {
        const { data: current, error: readError } = await supabase.from("os_documents").select("content_hash,status").eq("id", job.document_id).single();
        if (readError)
            throw new ApiError(503, "INDEX_RETRY_CHECK_FAILED", "재시도 문서 상태를 확인하지 못했습니다.");
        if (!current || current.status === "archived" || current.content_hash !== job.content_hash)
            continue;
        const { data: active, error: activeError } = await supabase.from("os_embedding_jobs").select("id").eq("document_id", job.document_id).eq("content_hash", job.content_hash).in("status", ["pending", "running"]).limit(1);
        if (activeError)
            throw new ApiError(503, "INDEX_RETRY_CHECK_FAILED", "실행 중인 작업을 확인하지 못했습니다.");
        if (active?.length)
            continue;
        const { data: changed, error: updateError } = await supabase.from("os_embedding_jobs").update({ status: "pending", started_at: null, finished_at: null, last_error: null }).eq("id", job.id).eq("content_hash", current.content_hash).eq("status", "failed").select("id");
        if (updateError?.code === "23505")
            continue;
        if (updateError)
            throw new ApiError(503, "INDEX_RETRY_FAILED", "일부 재시도 등록을 완료하지 못했습니다. 현황을 확인하고 다시 실행해 주세요.");
        retried += changed?.length ?? 0;
    }
    return retried;
}
