import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { apiErrorResponse, ApiError, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { indexDocument } from "@/lib/server/indexing";
import type { DocumentStatus } from "@/lib/types";
import { documentCreateSchema, documentUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50), 1), 100);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
    const statuses = url.searchParams.get("statuses")?.split(",").filter(Boolean) as DocumentStatus[] | undefined;
    const owner = url.searchParams.get("owner");
    const folder = url.searchParams.get("folder");
    const query = url.searchParams.get("q")?.replace(/[%_,()]/g, " ").trim();

    let builder = actor.supabase
      .from("os_documents")
      .select("*", { count: "exact" })
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (statuses?.length) builder = builder.in("status", statuses);
    if (owner) builder = builder.eq("owner_id", owner);
    if (folder) builder = builder.eq("folder", folder);
    if (query) builder = builder.or(`title.ilike.%${query}%,content_md.ilike.%${query}%`);
    const { data, count, error } = await builder;
    if (error) throw new ApiError(400, "DOCUMENT_LIST_FAILED", "문서 목록을 불러오지 못했습니다.", error.message);
    return NextResponse.json({ documents: data ?? [], total: count ?? 0 });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = documentCreateSchema.parse(await parseJson(request));
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

    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.content !== undefined) patch.content_md = input.content;
    if (input.folder !== undefined) patch.folder = input.folder;
    if (input.brand !== undefined) patch.brand = input.brand;
    if (input.team !== undefined) patch.team = input.team;
    if (input.tags !== undefined) patch.tags = input.tags;
    const { data, error } = await actor.supabase.from("os_documents").update(patch).eq("id", input.id).select("*").single();
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
