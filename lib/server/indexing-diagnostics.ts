import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { summarizeIndexCoverage, type IndexDocument, type IndexJob } from "@/lib/indexing-diagnostics";
export async function readIndexSnapshot(documentClient: SupabaseClient, jobClient = createServiceSupabase()) {
    const documents: IndexDocument[] = [];
    let truncated = false;
    const deadline = Date.now() + 12000;
    const signal = () => { if (Date.now() >= deadline)
        throw new ApiError(503, "INDEX_PROGRESS_TIMEOUT", "검색 준비 현황 조회가 지연되고 있습니다."); return AbortSignal.timeout(Math.min(5000, deadline - Date.now())); };
    for (let offset = 0; offset < 20000; offset += 500) {
        const { data, error } = await documentClient.from("os_documents").select("id,content_hash,status").neq("status", "archived").order("id").range(offset, offset + 499).abortSignal(signal());
        if (error)
            throw new ApiError(503, "INDEX_PROGRESS_UNAVAILABLE", "검색 준비 현황을 확인하지 못했습니다.");
        documents.push(...(data ?? []));
        if ((data?.length ?? 0) < 500)
            break;
        if (offset === 19500)
            truncated = true;
    }
    const jobs: IndexJob[] = [];
    // A user's RLS-visible document IDs are the only keys used with the service client.
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, Math.ceil(documents.length / 100)) }, async () => {
        while (cursor < documents.length) {
            const start = cursor;
            cursor += 100;
            const ids = documents.slice(start, start + 100).map(row => row.id);
            for (let offset = 0; offset < 10000; offset += 500) {
                const { data, error } = await jobClient.from("os_embedding_jobs").select("id,document_id,content_hash,status,last_error,created_at").in("document_id", ids).order("id").range(offset, offset + 499).abortSignal(signal());
                if (error)
                    throw new ApiError(503, "INDEX_PROGRESS_UNAVAILABLE", "검색 준비 현황을 확인하지 못했습니다.");
                jobs.push(...(data ?? []));
                if ((data?.length ?? 0) < 500)
                    break;
                if (offset === 9500)
                    truncated = true;
            }
        }
    }));
    return { documents, jobs, truncated };
}
export async function getIndexCoverage(client: SupabaseClient) { const snapshot = await readIndexSnapshot(client); return summarizeIndexCoverage(snapshot.documents, snapshot.jobs, snapshot.truncated); }
