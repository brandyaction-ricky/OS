import { NextResponse } from "next/server";
import { apiErrorResponse, ApiError } from "@/lib/http";
import { buildKnowledgeGraph, extractWikiLinks, type KnowledgeLinkSource } from "@/lib/knowledge-links";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { withIgnoredLinks } from "@/lib/knowledge/ignored-links";
import { POLICY_FIELDS, readableKnowledgePages } from "@/lib/server/knowledge-page-access";
import { packKnowledgeGraph } from "@/lib/knowledge/graph-transport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The graph only needs each body's [[links]]. Keep them per document and body fingerprint (content_hash, set by the
// os_documents write trigger on every save) on this warm instance, so a later request reads changed bodies only
// (the visible bodies took 3.7–7.3 s on 2026-11-02).
// ponytail: per-instance memory; a stored links column if cold starts stay slow.
const linkCache = new Map<string, { at: string; links: string[] }>();

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const service = createServiceSupabase();
    const documents: KnowledgeLinkSource[] = [];
    const pageSize = 500;
    let stewardReady = true;
    // Server-Timing: which stage of this read is slow (12 s on 2026-11-02 before the pages and ignore checks ran together).
    const timing: string[] = [], started = performance.now();
    let mark = started;
    const lap = (name: string) => { const now = performance.now(); timing.push(`${name};dur=${Math.round(now - mark)}`); mark = now; };

    const readPage = async (offset: number) => {
      let { data, error } = await service
        .from("os_documents")
        .select("id,title,content_md,folder,status,owner_id,source_ref,parent_document_id,current_version,steward_id,source,meeting_record_id,updated_at")
        .neq("status", "archived")
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error?.code === "42703" || error?.code === "PGRST204") {
        stewardReady = false;
        let legacy = await service.from("os_documents")
          .select("id,title,content_md,folder,status,owner_id,source_ref,parent_document_id,current_version")
          .neq("status", "archived").order("id", { ascending: true }).range(offset, offset + pageSize - 1);
        if (legacy.error?.code === "42703" || legacy.error?.code === "PGRST204") {
          const oldest = await service.from("os_documents")
            .select("id,title,content_md,folder,status,owner_id,source_ref,current_version")
            .neq("status", "archived").order("id", { ascending: true }).range(offset, offset + pageSize - 1);
          legacy = { ...oldest, data: oldest.data?.map((row) => ({ ...row, parent_document_id: null })) ?? null } as typeof legacy;
        }
        data = legacy.data?.map((row) => ({ ...row, steward_id: null, source:"wiki", meeting_record_id:null, updated_at:null })) ?? null;
        error = legacy.error;
      }
      if (error) throw new ApiError(400, "KNOWLEDGE_GRAPH_FAILED", "지식 연결을 불러오지 못했습니다.", error.message);
      return (data ?? []) as KnowledgeLinkSource[];
    };
    // Bodies are only parsed for documents this viewer can see, and reading every body made this slow (4.6–12.7 s on
    // 2026-11-02): read the light columns of every document first, decide what is visible, then fetch just those bodies.
    const META = `${POLICY_FIELDS},title,folder,source_ref,current_version,updated_at,content_hash`;
    const readMeta = async (offset: number) => service.from("os_documents").select(META).neq("status", "archived").order("id", { ascending: true }).range(offset, offset + pageSize - 1);
    const { count } = await service.from("os_documents").select("id", { count: "exact", head: true }).neq("status", "archived");
    const metaPages = await Promise.all(Array.from({ length: Math.max(1, Math.ceil((count ?? 0) / pageSize)) }, (_, i) => readMeta(i * pageSize)));
    let readable: Set<string>;
    if (metaPages.some(page => page.error?.code === "42703" || page.error?.code === "PGRST204")) {
      // An older schema without the policy columns: the original read with bodies.
      const pages = [await readPage(0)];
      for (let offset = pageSize; pages[pages.length - 1].length === pageSize; offset += pageSize) pages.push(await readPage(offset));
      documents.push(...pages.flat());
      lap("documents");
      readable = await readableKnowledgePages(actor, documents);
      lap("access");
    } else {
      const failed = metaPages.find(page => page.error);
      if (failed?.error) throw new ApiError(400, "KNOWLEDGE_GRAPH_FAILED", "지식 연결을 불러오지 못했습니다.", failed.error.message);
      // A document added meanwhile is picked up by the tail read; duplicates from shifted pages are dropped.
      for (let offset = metaPages.length * pageSize; (metaPages[metaPages.length - 1].data ?? []).length === pageSize; offset += pageSize) {
        const tail = await readMeta(offset);
        if (tail.error) throw new ApiError(400, "KNOWLEDGE_GRAPH_FAILED", "지식 연결을 불러오지 못했습니다.", tail.error.message);
        metaPages.push(tail);
      }
      const seen = new Set<string>();
      for (const row of metaPages.flatMap(page => (page.data ?? []) as unknown as Omit<KnowledgeLinkSource, "content_md">[])) if (!seen.has(row.id)) { seen.add(row.id); documents.push({ ...row, content_md: "" }); }
      lap("documents");
      readable = await readableKnowledgePages(actor, documents);
      lap("access");
      // Bodies of the visible documents that changed since this instance last read them, 200 ids a request and four at a time
      // so a small database is not flooded. A document without a fingerprint is always read.
      const visibleRows = documents.filter(row => readable.has(row.id));
      const print = (row: KnowledgeLinkSource) => (row as KnowledgeLinkSource & { content_hash?: string | null }).content_hash ?? "";
      const stale = visibleRows.filter(row => !print(row) || linkCache.get(row.id)?.at !== print(row)).map(row => row.id);
      const chunks = Array.from({ length: Math.ceil(stale.length / 200) }, (_, i) => stale.slice(i * 200, i * 200 + 200));
      const at = new Map(visibleRows.map(row => [row.id, print(row)]));
      for (let i = 0; i < chunks.length; i += 4) {
        const results = await Promise.all(chunks.slice(i, i + 4).map(chunk => service.from("os_documents").select("id,content_md").in("id", chunk)));
        for (const result of results) {
          if (result.error) throw new ApiError(400, "KNOWLEDGE_GRAPH_FAILED", "지식 연결을 불러오지 못했습니다.", result.error.message);
          for (const row of result.data ?? []) linkCache.set(row.id, { at: at.get(row.id) ?? "", links: extractWikiLinks(row.content_md ?? "") });
        }
      }
      // buildKnowledgeGraph reads links from content_md: give it just the links back.
      for (const row of visibleRows) row.content_md = (linkCache.get(row.id)?.links ?? []).map(link => `[[${link}]]`).join("\n");
      timing.push(`stale;desc="${stale.length}/${visibleRows.length}"`);
      lap("bodies");
    }
    // Hidden links are few: read them once and keep the ones on visible pages (was one query per 100 visible ids).
    const ignored:Array<{action:string;target_id:string;detail:Record<string,unknown>}>=[];
    for(let offset=0;;offset+=1000){
      const result=await service.from("os_knowledge_events").select("action,target_id,detail").eq("action","link_ignore").order("id").range(offset,offset+999);
      if(result.error){if(result.error.code==="42P01"||result.error.code==="PGRST205")break;throw new ApiError(503,"KNOWLEDGE_GRAPH_FAILED","연결 숨김 기록을 확인하지 못했습니다.");}
      ignored.push(...(result.data??[]).filter(row=>readable.has(row.target_id)));if(!result.data||result.data.length<1000)break;
    }
    lap("ignored");
    const graph = { ...withIgnoredLinks(buildKnowledgeGraph(documents, readable),ignored), stewardReady };
    const body = new URL(request.url).searchParams.get("format") === "compact" ? packKnowledgeGraph(graph) : graph;
    lap("build");
    timing.push(`total;dur=${Math.round(performance.now() - started)}`);
    return NextResponse.json(body,{headers:{"Cache-Control":"private, no-store","Server-Timing":timing.join(", ")}});
  } catch (error) {
    return apiErrorResponse(error);
  }
}
