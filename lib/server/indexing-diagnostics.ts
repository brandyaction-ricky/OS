import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { summarizeIndexCoverage, type IndexDocument, type IndexJob } from "@/lib/indexing-diagnostics";
export async function readIndexSnapshot(documentClient: SupabaseClient, jobClient = createServiceSupabase()) {
    const deadline = Date.now() + 12000;
    const signal = () => { if (Date.now() >= deadline)
        throw new ApiError(503, "INDEX_PROGRESS_TIMEOUT", "검색 준비 현황 조회가 지연되고 있습니다."); return AbortSignal.timeout(Math.min(5000, deadline - Date.now())); };
    const unavailable = () => new ApiError(503, "INDEX_PROGRESS_UNAVAILABLE", "검색 준비 현황을 확인하지 못했습니다.");
    // Pages used to be read one after another (12 document pages, then ~15 rounds of job pages: about 2 s on
    // the 작동 상태 screen). The count fixes every document page, so they are read together.
    const PAGE = 1000, MAX_DOCUMENTS = 20000;
    const documentQuery = () => documentClient.from("os_documents").select("id,content_hash,status").neq("status", "archived");
    const { count, error: countError } = await documentClient.from("os_documents").select("id", { count: "exact", head: true }).neq("status", "archived").abortSignal(signal());
    if (countError)
        throw unavailable();
    const offsets = Array.from({ length: Math.max(1, Math.ceil(Math.min(count ?? 0, MAX_DOCUMENTS) / PAGE)) }, (_, page) => page * PAGE);
    const pages = await Promise.all(offsets.map(offset => documentQuery().order("id").range(offset, offset + PAGE - 1).abortSignal(signal())));
    const documents: IndexDocument[] = [];
    for (const { data, error } of pages) {
        if (error)
            throw unavailable();
        documents.push(...(data ?? []));
    }
    // Rows added after the count still arrive, up to the same cap as before.
    for (let offset = offsets[offsets.length - 1] + PAGE; (pages[pages.length - 1].data?.length ?? 0) === PAGE && offset < MAX_DOCUMENTS; offset += PAGE) {
        const page = await documentQuery().order("id").range(offset, offset + PAGE - 1).abortSignal(signal());
        if (page.error)
            throw unavailable();
        pages.push(page);
        documents.push(...(page.data ?? []));
    }
    const truncatedDocuments = (count ?? 0) > MAX_DOCUMENTS || (pages[pages.length - 1].data?.length ?? 0) === PAGE && documents.length >= MAX_DOCUMENTS;
    const jobs: IndexJob[] = [];
    let truncated = truncatedDocuments;
    // A user's RLS-visible document IDs are the only keys used with the service client.
    const chunks: string[][] = [];
    for (let start = 0; start < documents.length; start += 200)
        chunks.push(documents.slice(start, start + 200).map(row => row.id));
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(8, chunks.length) }, async () => {
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
