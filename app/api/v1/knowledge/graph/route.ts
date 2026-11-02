import { NextResponse } from "next/server";
import { apiErrorResponse, ApiError } from "@/lib/http";
import { buildKnowledgeGraph, type KnowledgeLinkSource } from "@/lib/knowledge-links";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { withIgnoredLinks } from "@/lib/knowledge/ignored-links";
import { readableKnowledgePages } from "@/lib/server/knowledge-page-access";
import { packKnowledgeGraph } from "@/lib/knowledge/graph-transport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    // Every page at once (the bodies make each page heavy); a document added meanwhile is picked up by the tail read.
    const { count } = await service.from("os_documents").select("id", { count: "exact", head: true }).neq("status", "archived");
    const pages = await Promise.all(Array.from({ length: Math.max(1, Math.ceil((count ?? 0) / pageSize)) }, (_, i) => readPage(i * pageSize)));
    for (let offset = pages.length * pageSize; pages[pages.length - 1].length === pageSize; offset += pageSize) pages.push(await readPage(offset));
    const seen = new Set<string>();
    for (const row of pages.flat()) if (!seen.has(row.id)) { seen.add(row.id); documents.push(row); }
    lap("documents");

    const readable = await readableKnowledgePages(actor, documents);
    lap("access");
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
