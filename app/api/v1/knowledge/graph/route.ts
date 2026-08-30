import { NextResponse } from "next/server";
import { apiErrorResponse, ApiError } from "@/lib/http";
import { buildKnowledgeGraph, type KnowledgeLinkSource } from "@/lib/knowledge-links";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);
    const service = createServiceSupabase();
    const documents: KnowledgeLinkSource[] = [];
    const pageSize = 500;

    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await service
        .from("os_documents")
        .select("id,title,content_md,folder,status,owner_id")
        .neq("status", "archived")
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw new ApiError(400, "KNOWLEDGE_GRAPH_FAILED", "지식 연결을 불러오지 못했습니다.", error.message);
      documents.push(...((data ?? []) as KnowledgeLinkSource[]));
      if (!data || data.length < pageSize) break;
    }

    return NextResponse.json(buildKnowledgeGraph(documents));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
