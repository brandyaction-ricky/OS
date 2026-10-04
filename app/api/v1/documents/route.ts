import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { apiErrorResponse, ApiError, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { indexDocument } from "@/lib/server/indexing";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { DocumentStatus, KnowledgeDocument } from "@/lib/types";
import { readableKnowledgePages } from "@/lib/server/knowledge-page-access";
import { documentCreateSchema, documentUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50), 1), 200);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
    const statuses = url.searchParams.get("statuses")?.split(",").filter(Boolean) as DocumentStatus[] | undefined;
    const owner = url.searchParams.get("owner");
    const folder = url.searchParams.get("folder");
    const query = url.searchParams.get("q")?.replace(/[%_,()]/g, " ").trim();
    const view = url.searchParams.get("view");
    const includeContent = view !== "summary" && view !== "page-summary";

    if (url.searchParams.get("view") === "folders") {
      const folders = new Set<string>();
      for (let offset = 0; offset < 10_000; offset += 1_000) {
        const { data, error } = await createServiceSupabase().from("os_documents").select("folder").neq("status", "archived").order("id").range(offset, offset + 999);
        if (error) throw new ApiError(400, "DOCUMENT_FOLDER_LIST_FAILED", "지식 폴더 목록을 불러오지 못했습니다.", error.message);
        for (const row of data ?? []) if (row.folder) folders.add(row.folder);
        if (!data || data.length < 1_000) break;
      }
      return NextResponse.json({ folders: [...folders].sort((a, b) => a.localeCompare(b, "ko", { numeric: true })) });
    }

    // Scope is a workspace filter, not an access boundary. Authentication is
    // checked above; the server client avoids hiding another member's notes.
    const summaryColumns = "id,title,folder,status,brand,team,tags,source,source_ref,owner_id,created_by,current_version,created_at,updated_at";
    const listDocuments = (columns: string) => {
      let builder = createServiceSupabase()
      .from("os_documents")
      .select(columns, { count: "exact" })
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);
    if (statuses?.length) builder = builder.in("status", statuses);
    if (owner) builder = builder.eq("owner_id", owner);
    if (url.searchParams.get("exactFolder") === "true") builder = builder.eq("folder", folder === "분류 없음" ? "" : folder ?? "");
    else if (folder) builder = builder.or(`folder.eq.${folder},folder.like.${folder}/%`);
    for (const field of ["team", "brand"] as const) { const value = url.searchParams.get(field); if (value) builder = builder.eq(field, value); }
    const tag = url.searchParams.get("tag");
    if (tag) builder = builder.contains("tags", [tag]);
    const scope = url.searchParams.get("scope");
    if (scope === "mine_company") builder = builder.or(`owner_id.eq.${actor.id},status.eq.canonical`);
    else if (scope === "mine") builder = builder.eq("owner_id", actor.id);
    else if (["canonical", "team", "archived"].includes(scope ?? "")) builder = builder.eq("status", scope);
    else if (scope === "review") builder = builder.in("status", ["review", "reviewed"]);
    if (scope && scope !== "archived") builder = builder.neq("status", "archived");
    if (query) builder = builder.or(`title.ilike.%${query}%,content_md.ilike.%${query}%,source_ref.ilike.%${query}%`);
      return builder;
    };
    const requestedColumns = includeContent ? "*" : view === "page-summary" ? `${summaryColumns},parent_document_id,page_order` : summaryColumns;
    let { data, count, error } = await listDocuments(requestedColumns);
    // A Preview can run ahead of the additive DEV migration. Legacy clients
    // and the existing tree must remain readable until that migration lands.
    if (view === "page-summary" && error?.code === "42703") ({ data, count, error } = await listDocuments(summaryColumns));
    if (error) throw new ApiError(400, "DOCUMENT_LIST_FAILED", "문서 목록을 불러오지 못했습니다.", error.message);
    const rows = (data ?? []) as unknown as KnowledgeDocument[];
    const allowed = await readableKnowledgePages(actor, rows);
    return NextResponse.json({ documents: rows.filter(row => allowed.has(row.id)), total: count ?? 0 });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = documentCreateSchema.parse(await parseJson(request));
    if (input.parentDocumentId) {
      const { data: parent, error: parentError } = await actor.supabase.from("os_documents")
        .select("id,folder,status,owner_id,parent_document_id")
        .eq("id", input.parentDocumentId)
        .maybeSingle();
      if (parentError || !parent || parent.status === "archived") throw new ApiError(404, "PAGE_PARENT_NOT_FOUND", "상위 페이지를 열 수 없습니다.");
      if (!(await readableKnowledgePages(actor, [parent])).has(parent.id)) throw new ApiError(404, "PAGE_PARENT_NOT_FOUND", "상위 페이지를 열 수 없습니다.");
      if (parent.folder !== input.folder) throw new ApiError(400, "PAGE_FOLDER_MISMATCH", "하위 페이지는 상위 페이지와 같은 폴더에서 시작해야 합니다.");
    }
    if (input.sourceRef) {
      const { data: existing, error: duplicateCheckError } = await actor.supabase
        .from("os_documents")
        .select("id,title")
        .eq("source", input.source)
        .eq("source_ref", input.sourceRef)
        .maybeSingle();
      if (duplicateCheckError) throw new ApiError(400, "DOCUMENT_DUPLICATE_CHECK_FAILED", "중복 문서를 확인하지 못했습니다.", duplicateCheckError.message);
      if (existing) throw new ApiError(409, "DOCUMENT_SOURCE_EXISTS", "같은 원본 파일에서 가져온 문서가 이미 있습니다.", existing);
    }
    const { data, error } = await actor.supabase
      .from("os_documents")
      .insert({
        title: input.title,
        content_md: input.content,
        folder: input.folder,
        brand: input.brand,
        team: input.team || actor.team,
        tags: input.tags,
        source: input.source,
        source_ref: input.sourceRef,
        ...(input.parentDocumentId ? { parent_document_id: input.parentDocumentId } : {}),
        status: "draft",
        owner_id: actor.id,
        created_by: actor.id,
      })
      .select("*")
      .single();
    if (error || !data) throw new ApiError(400, "DOCUMENT_CREATE_FAILED", "문서를 저장하지 못했습니다.", error?.message);
    let indexing: "ready" | "queued" = "queued";
    try { indexing = await indexDocument(data.id); } catch (indexError) { console.error("indexing failed", indexError); }
    return NextResponse.json({ document: data, indexing }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_DOCUMENT", "문서 내용을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = documentUpdateSchema.parse(await parseJson(request));
    const { data: current, error: readError } = await actor.supabase
      .from("os_documents")
      .select("*")
      .eq("id", input.id)
      .single();
    if (readError || !current) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "문서를 찾을 수 없습니다.");
    if (current.current_version !== input.expectedVersion) {
      throw new ApiError(409, "VERSION_CONFLICT", "다른 사람이 먼저 수정했습니다. 최신 버전을 다시 불러와 주세요.", { currentVersion: current.current_version });
    }

    const { data, error } = await actor.supabase.rpc("os_update_document", {
      p_document_id: input.id,
      p_expected_version: input.expectedVersion,
      p_title: input.title ?? current.title,
      p_content_md: input.content ?? current.content_md,
      p_folder: input.folder ?? current.folder,
      p_brand: input.brand ?? current.brand,
      p_team: input.team ?? current.team,
      p_tags: input.tags ?? current.tags,
      p_reason: input.reason,
    });
    if (error?.message?.startsWith("OS_VERSION_CONFLICT:")) throw new ApiError(409, "VERSION_CONFLICT", "다른 사람이 먼저 수정했습니다. 최신 버전을 확인하고 다시 시도해 주세요.");
    if (error?.message?.includes("OS_ATTACHMENT_EXPIRED")) {
      throw new ApiError(409, "KNOWLEDGE_ATTACHMENT_EXPIRED", "첨부 자료의 보관 시간이 지나 저장하지 못했습니다. 해당 자료를 다시 첨부해 주세요.");
    }
    if (error || !data) throw new ApiError(400, "DOCUMENT_UPDATE_FAILED", "문서를 수정하지 못했습니다.", error?.message);
    let indexing: "ready" | "queued" = "queued";
    if (input.content !== undefined) {
      try { indexing = await indexDocument(data.id); } catch (indexError) { console.error("indexing failed", indexError); }
    }
    return NextResponse.json({ document: data, indexing });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_DOCUMENT", "수정 내용을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new ApiError(400, "DOCUMENT_ID_REQUIRED", "문서 ID가 필요합니다.");
    const { data, error } = await actor.supabase.rpc("os_set_document_status", { p_document_id: id, p_to: "archived", p_note: "OS에서 보관" });
    if (error) throw new ApiError(400, "DOCUMENT_ARCHIVE_FAILED", "문서를 보관하지 못했습니다.", error.message);
    return NextResponse.json({ deleted: true, document: data });
  } catch (error) { return apiErrorResponse(error); }
}
