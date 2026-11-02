import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { summarizeIndexCoverage, type IndexDocument, type IndexJob } from "@/lib/indexing-diagnostics";
export async function readIndexSnapshot(documentClient: SupabaseClient, jobClient = createServiceSupabase()) {
    const deadline = Date.now() + 12000;
    const signal = () => { if (Date.now() >= deadline)
        throw new ApiError(503, "INDEX_PROGRESS_TIMEOUT", "검색 준비 현황 조회가 지연되고 있습니다."); return AbortSignal.timeout(Math.min(5000, deadline - Date.now())); };
    const unavailable = () => new ApiError(503, "INDEX_PROGRESS_UNAVAILABLE", "검색 준비 현황을 확인하지 못했습니다.");
    // Pages used to be read one after another (about 2 s on the 작동 상태 screen), then after a count. Ids are random UUIDs:
    // eight id ranges read side by side cover every document in about one round trip, and keyset pages never make RLS
    // re-check skipped rows the way offsets do.
    const PAGE = 1000, MAX_DOCUMENTS = 20000;
    const bounds = ["0", "2", "4", "6", "8", "a", "c", "e"].map((from, index, all) => ({ from: `${from}0000000-0000-0000-0000-000000000000`, to: all[index + 1] ? `${all[index + 1]}0000000-0000-0000-0000-000000000000` : null }));
    let truncatedDocuments = false;
    const slices = await Promise.all(bounds.map(async ({ from, to }) => {
        const slice: IndexDocument[] = [];
        for (let cursor = from, first = true;; first = false) {
            let query = documentClient.from("os_documents").select("id,content_hash,status").neq("status", "archived");
            query = first ? query.gte("id", cursor) : query.gt("id", cursor);
            if (to)
                query = query.lt("id", to);
            const { data, error } = await query.order("id").limit(PAGE).abortSignal(signal());
            if (error)
                throw unavailable();
            slice.push(...(data ?? []));
            if ((data?.length ?? 0) < PAGE)
                return slice;
            // The same 20,000 cap as before, shared by the ranges.
            if (slice.length >= MAX_DOCUMENTS / bounds.length) {
                truncatedDocuments = true;
                return slice;
            }
            cursor = data![data!.length - 1].id;
        }
    }));
    const documents: IndexDocument[] = slices.flat();
    const jobs: IndexJob[] = [];
    let truncated = truncatedDocuments;
    // A user's RLS-visible document IDs are the only keys used with the service client.
    const chunks: string[][] = [];
    for (let start = 0; start < documents.length; start += 200)
        chunks.push(documents.slice(start, start + 200).map(row => row.id));
    let next = 0;
    // Sixteen 200-id chunks at a time (17 chunks for ~3,300 documents) instead of eight.
    await Promise.all(Array.from({ length: Math.min(16, chunks.length) }, async () => {
        while (next < chunks.length) {
            const ids = chunks[next++];
            for (let offset = 0; offset < 10000; offset += PAGE) {
                const { data, error } = await jobClient.from("os_embedding_jobs").select("id,document_id,content_hash,status,last_error,created_at").in("document_id", ids).order("id").range(offset, offset + PAGE - 1).abortSignal(signal());
                if (error)
                    throw unavailable();
                jobs.push(...(data ?? []));
                if ((data?.length ?? 0) < PAGE)
                    break;
                if (offset === 9000)
                    truncated = true;
            }
        }
    }));
    return { documents, jobs, truncated };
}
export async function getIndexCoverage(client: SupabaseClient) { const snapshot = await readIndexSnapshot(client); return summarizeIndexCoverage(snapshot.documents, snapshot.jobs, snapshot.truncated); }
