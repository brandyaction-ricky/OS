export const INDEX_FAILURE_LABELS = { superseded: "지난 버전으로 대체", archived: "보관 문서", timeout: "응답 시간 초과", rate_limit: "호출 한도", quota: "사용량·결제 한도", authentication: "공급자 인증", configuration: "연결 설정", storage: "검색 자료 저장", provider: "검색 공급자", unknown: "원인 미분류" } as const;
export type IndexFailure = keyof typeof INDEX_FAILURE_LABELS;
export function classifyIndexingFailure(reason: unknown): IndexFailure {
    const value = reason && typeof reason === "object" ? reason as {
        code?: unknown;
        message?: unknown;
        name?: unknown;
    } : {};
    const code = String(value.code ?? "");
    const message = typeof reason === "string" ? reason : String(value.message ?? "");
    if (message.startsWith("[")) {
        const category = message.slice(1, message.indexOf("]"));
        if (Object.hasOwn(INDEX_FAILURE_LABELS, category))
            return category as IndexFailure;
    }
    if (/새 문서 버전으로 대체|^stale$/.test(message))
        return "superseded";
    if (/archived/i.test(code))
        return "archived";
    if (/TIMEOUT|57014/i.test(code) || value.name === "AbortError" || /시간.*초과|timed?\s*out/i.test(message))
        return "timeout";
    if (/QUOTA/.test(code))
        return "quota";
    if (/RATE_LIMIT/.test(code) || code === "429")
        return "rate_limit";
    if (/AUTH/.test(code) || ["401", "403"].includes(code))
        return "authentication";
    if (/NOT_CONFIGURED/.test(code))
        return "configuration";
    if (/^(22|23|42|53|PGRST)/.test(code) || /STORAGE|DATABASE|RPC/.test(code))
        return "storage";
    if (/EMBEDDING|PROVIDER/.test(code))
        return "provider";
    return "unknown";
}
export function safeIndexingFailure(reason: unknown) { const code = classifyIndexingFailure(reason); return `[${code}] ${INDEX_FAILURE_LABELS[code]}`; }
export interface IndexDocument {
    id: string;
    content_hash: string;
    status: string;
}
export interface IndexJob {
    id: number;
    document_id: string;
    content_hash: string;
    status: string;
    last_error: string | null;
    created_at: string;
}
export interface IndexCoverage {
    total: number;
    done: number;
    failed: number;
    pending: number;
    running: number;
    untracked: number;
    historicalFailed: number;
    failureReasons: Array<{
        code: IndexFailure;
        label: string;
        count: number;
    }>;
    capturedAt: string;
    truncated: boolean;
}
export function currentIndexJobs(documents: IndexDocument[], jobs: IndexJob[]) {
    const active = new Map(documents.filter(row => row.status !== "archived").map(row => [row.id, row]));
    const current = new Map<string, IndexJob>();
    for (const job of jobs) {
        if (active.get(job.document_id)?.content_hash !== job.content_hash)
            continue;
        const previous = current.get(job.document_id);
        if (!previous || job.created_at > previous.created_at || (job.created_at === previous.created_at && job.id > previous.id))
            current.set(job.document_id, job);
    }
    return current;
}
export function summarizeIndexCoverage(documents: IndexDocument[], jobs: IndexJob[], truncated = false): IndexCoverage {
    const active = documents.filter(row => row.status !== "archived"), current = currentIndexJobs(active, jobs);
    const result: IndexCoverage = { total: active.length, done: 0, failed: 0, pending: 0, running: 0, untracked: 0, historicalFailed: 0, failureReasons: [], capturedAt: new Date().toISOString(), truncated };
    const reasons = new Map<IndexFailure, number>();
    for (const row of active) {
        const job = current.get(row.id);
        if (!job || !["done", "failed", "pending", "running"].includes(job.status))
            result.untracked++;
        else
            result[job.status as "done" | "failed" | "pending" | "running"]++;
    }
    for (const job of jobs) {
        if (job.status !== "failed")
            continue;
        if (current.get(job.document_id)?.id !== job.id) {
            result.historicalFailed++;
            continue;
        }
        const code = classifyIndexingFailure(job.last_error);
        reasons.set(code, (reasons.get(code) ?? 0) + 1);
    }
    result.failureReasons = [...reasons].map(([code, count]) => ({ code, label: INDEX_FAILURE_LABELS[code], count })).sort((a, b) => b.count - a.count);
    return result;
}
