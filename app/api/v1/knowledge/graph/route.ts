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

    for (let offset = 0; ; offset += pageSize) {
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
      const rows = (data ?? []) as KnowledgeLinkSource[];
      documents.push(...rows);
      if (!data || data.length < pageSize) break;
    }

    const readable = await readableKnowledgePages(actor, documents);
    const ignored:Array<{action:string;target_id:string;detail:Record<string,unknown>}>=[];
    const ids=[...readable];
    for(let start=0;start<ids.length;start+=100){
      for(let offset=0;;offset+=500){
        const result=await service.from("os_knowledge_events").select("action,target_id,detail").eq("action","link_ignore").in("target_id",ids.slice(start,start+100)).order("id").range(offset,offset+499);
        if(result.error){if(result.error.code==="42P01"||result.error.code==="PGRST205")break;throw new ApiError(503,"KNOWLEDGE_GRAPH_FAILED","연결 숨김 기록을 확인하지 못했습니다.");}
        ignored.push(...(result.data??[]));if(!result.data||result.data.length<500)break;
      }
    }
    const graph = { ...withIgnoredLinks(buildKnowledgeGraph(documents, readable),ignored), stewardReady };
    return NextResponse.json(new URL(request.url).searchParams.get("format") === "compact" ? packKnowledgeGraph(graph) : graph,{headers:{"Cache-Control":"private, no-store"}});
  } catch (error) {
    return apiErrorResponse(error);
  }
}
