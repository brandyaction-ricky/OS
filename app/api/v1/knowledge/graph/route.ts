import { NextResponse } from "next/server";
import { apiErrorResponse, ApiError } from "@/lib/http";
import { buildKnowledgeGraph, type KnowledgeLinkSource } from "@/lib/knowledge-links";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { readableKnowledgePages } from "@/lib/server/knowledge-page-access";

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
        .select("id,title,content_md,folder,status,owner_id,source_ref,parent_document_id,current_version,steward_id")
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
        data = legacy.data?.map((row) => ({ ...row, steward_id: null })) ?? null;
        error = legacy.error;
      }
      if (error) throw new ApiError(400, "KNOWLEDGE_GRAPH_FAILED", "지식 연결을 불러오지 못했습니다.", error.message);
      const rows = (data ?? []) as KnowledgeLinkSource[];
      const readable = await readableKnowledgePages(actor, rows);
      documents.push(...rows.filter((row) => readable.has(row.id)));
      if (!data || data.length < pageSize) break;
    }

    return NextResponse.json({ ...buildKnowledgeGraph(documents), stewardReady });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
