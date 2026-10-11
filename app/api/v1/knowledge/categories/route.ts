import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { CATEGORY_COLORS } from "@/lib/knowledge/model";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const idSchema = z.string().uuid();
const detailsSchema = z.object({
  name: z.string().trim().min(1).max(20),
  color: z.enum(CATEGORY_COLORS),
});
const createSchema = detailsSchema.extend({ space: z.enum(["mine", "team"]) });
const updateSchema = detailsSchema.extend({ id: idSchema });
const deleteSchema = z.object({ id: idSchema });

function commandError(code?: string): ApiError {
  if (code === "42501") return new ApiError(403, "CATEGORY_FORBIDDEN", "카테고리를 변경할 권한이 없습니다.");
  if (code === "P0002") return new ApiError(404, "CATEGORY_NOT_FOUND", "카테고리를 찾을 수 없습니다.");
  if (code === "23505") return new ApiError(409, "CATEGORY_DUPLICATE", "같은 이름의 카테고리가 있습니다.");
  return new ApiError(503, "CATEGORY_SAVE_FAILED", "카테고리를 저장하지 못했습니다. 다시 시도해 주세요.");
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const { data, error } = await actor.supabase.from("os_doc_categories")
      .select("id,space,owner_id,name,color,sort_order")
      .is("archived_at", null).order("sort_order").order("name");
    if (error) throw commandError(error.code);
    return NextResponse.json({ categories: data ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const parsed = createSchema.safeParse(await parseJson(request, 4_096));
    if (!parsed.success) throw new ApiError(400, "INVALID_CATEGORY", "이름은 1~20자로 입력해 주세요.");
    const { data, error } = await actor.supabase.rpc("os_knowledge_command", { p: { action: "category.save", ...parsed.data } });
    if (error) throw commandError(error.code);
    return NextResponse.json({ id: data?.id ?? data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const parsed = updateSchema.safeParse(await parseJson(request, 4_096));
    if (!parsed.success) throw new ApiError(400, "INVALID_CATEGORY", "이름은 1~20자로 입력해 주세요.");
    const { error } = await actor.supabase.rpc("os_knowledge_command", { p: { action: "category.save", ...parsed.data } });
    if (error) throw commandError(error.code);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const parsed = deleteSchema.safeParse(await parseJson(request, 4_096));
    if (!parsed.success) throw new ApiError(400, "INVALID_CATEGORY", "카테고리를 다시 선택해 주세요.");
    const { data: category, error: lookupError } = await actor.supabase.from("os_doc_categories")
      .select("id,space,owner_id").eq("id", parsed.data.id).is("archived_at", null).maybeSingle();
    if (lookupError) throw commandError(lookupError.code);
    if (!category) throw new ApiError(404, "CATEGORY_NOT_FOUND", "카테고리를 찾을 수 없습니다.");
    if (category.space === "team" && actor.role !== "admin") throw commandError("42501");
    if (category.space === "mine" && category.owner_id !== actor.ownerId) throw commandError("42501");
    // The existing archive RPC clears assignments. Never call it while a document uses this category.
    const { count, error: countError } = await createServiceSupabase().from("os_documents")
      .select("id", { head: true, count: "exact" }).eq("category_id", category.id);
    if (countError) throw commandError(countError.code);
    if (count !== 0) throw new ApiError(409, "CATEGORY_IN_USE", "문서에 사용 중인 카테고리입니다. 문서의 카테고리를 먼저 변경해 주세요.");
    const { error } = await actor.supabase.rpc("os_knowledge_command", {
      p: { action: "category.archive", id: category.id, space: category.space },
    });
    if (error) throw commandError(error.code);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
