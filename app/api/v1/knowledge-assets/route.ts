import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { assetReferenceKey, KNOWLEDGE_ASSET_BUCKET, KNOWLEDGE_ASSET_TYPES, knowledgeAssetCreateSchema } from "@/lib/knowledge-assets";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

async function readableDocument(actor: Awaited<ReturnType<typeof authenticateRequest>>, documentId: string) {
  const { data, error } = await actor.supabase.from("os_documents").select("id,title,source_ref,owner_id").eq("id", documentId).maybeSingle();
  if (error || !data) throw new ApiError(404, "KNOWLEDGE_DOCUMENT_NOT_FOUND", "문서를 찾을 수 없거나 열람 권한이 없습니다.");
  return data;
}

function respondError(error: unknown) {
  if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_KNOWLEDGE_ASSET", "이미지 정보를 확인해 주세요.", error.flatten()));
  return apiErrorResponse(error);
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const documentIds = [...new Set((new URL(request.url).searchParams.get("documentIds") ?? "").split(",").filter(Boolean))].slice(0, 100);
    if (!documentIds.length) throw new ApiError(400, "KNOWLEDGE_DOCUMENT_IDS_REQUIRED", "문서 ID가 필요합니다.");
    for (const documentId of documentIds) await readableDocument(actor, documentId);
    const service = createServiceSupabase();
    const { data, error } = await service.from("os_document_assets").select("*").in("document_id", documentIds).order("created_at", { ascending: true });
    if (error) throw new ApiError(400, "KNOWLEDGE_ASSET_LIST_FAILED", "문서 이미지를 불러오지 못했습니다.", error.message);
    const assets = await Promise.all((data ?? []).map(async (asset) => {
      const { data: signed } = await service.storage.from(KNOWLEDGE_ASSET_BUCKET).createSignedUrl(asset.storage_path, 900);
      return { ...asset, url: signed?.signedUrl };
    }));
    return NextResponse.json({ assets, expiresIn: 900 }, { headers });
  } catch (error) { return respondError(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = knowledgeAssetCreateSchema.parse(await parseJson(request, 6_000));
    const document = await readableDocument(actor, input.documentId);
    if (document.owner_id !== actor.id && actor.role !== "admin") throw new ApiError(403, "KNOWLEDGE_ASSET_FORBIDDEN", "이 문서에 이미지를 연결할 권한이 없습니다.");
    const service = createServiceSupabase();
    if (input.sha256) {
      const { data: duplicate } = await service.from("os_document_assets").select("*").eq("document_id", input.documentId).eq("sha256", input.sha256).maybeSingle();
      if (duplicate) {
        const { data: alias, error: aliasError } = await service.from("os_document_assets").upsert({ ...duplicate, id: undefined, reference: input.reference, reference_key: assetReferenceKey(input.reference), file_name: input.fileName, source_document: document.source_ref || document.title, created_by: actor.id }, { onConflict: "document_id,reference_key" }).select("*").single();
        if (aliasError || !alias) throw new ApiError(400, "KNOWLEDGE_ASSET_ALIAS_FAILED", "중복 이미지를 문서 참조에 연결하지 못했습니다.", aliasError?.message);
        const { data: signed } = await service.storage.from(KNOWLEDGE_ASSET_BUCKET).createSignedUrl(alias.storage_path, 900);
        return NextResponse.json({ asset: { ...alias, url: signed?.signedUrl }, duplicate: true }, { headers });
      }
    }
    const extension = KNOWLEDGE_ASSET_TYPES[input.mimeType];
    const path = `documents/${input.documentId}/${randomUUID()}.${extension}`;
    const { data: upload, error: uploadError } = await service.storage.from(KNOWLEDGE_ASSET_BUCKET).createSignedUploadUrl(path);
    if (uploadError || !upload) throw new ApiError(400, "KNOWLEDGE_ASSET_SIGN_FAILED", "이미지 업로드 경로를 만들지 못했습니다.", uploadError?.message);
    const { data: asset, error } = await service.from("os_document_assets").upsert({
      document_id: input.documentId,
      reference: input.reference,
      reference_key: assetReferenceKey(input.reference),
      file_name: input.fileName,
      file_size: input.fileSize,
      mime_type: input.mimeType,
      storage_path: path,
      sha256: input.sha256 ?? null,
      source_document: document.source_ref || document.title,
      created_by: actor.id,
    }, { onConflict: "document_id,reference_key" }).select("*").single();
    if (error || !asset) throw new ApiError(400, "KNOWLEDGE_ASSET_SAVE_FAILED", "이미지 연결 정보를 저장하지 못했습니다.", error?.message);
    return NextResponse.json({ asset, upload: { path, token: upload.token }, duplicate: false }, { status: 201, headers });
  } catch (error) { return respondError(error); }
}
