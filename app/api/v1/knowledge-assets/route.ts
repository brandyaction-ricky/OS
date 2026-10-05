import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import {
  KNOWLEDGE_ASSET_IMAGE_TYPES,
  knowledgeAssetFinalizeSchema,
  knowledgeAssetPrepareSchema,
  knowledgeAssetReferenceSchema,
  knowledgeAssetReferences,
  knowledgeAssetRow,
  normalizeKnowledgeAssetReference,
  type KnowledgeAsset,
} from "@/lib/knowledge-assets";
import {
  KNOWLEDGE_ATTACHMENT_BUCKET,
  knowledgeAttachmentDocumentId,
  knowledgeAttachmentUploaderId,
  parseKnowledgeAttachmentTarget,
} from "@/lib/knowledge-attachments";
import { authenticateRequest, type RequestActor } from "@/lib/server/auth";
import { registerPendingKnowledgeAttachment } from "@/lib/server/knowledge-attachment-lifecycle";
import { createServiceSupabase } from "@/lib/supabase/server";
import { readableKnowledgePages } from "@/lib/server/knowledge-page-access";
import type { KnowledgeDocument } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const documentIdsSchema = z.array(z.string().uuid()).min(1).max(100);

async function readableDocument(actor: RequestActor, documentId: string) {
  const { data, error } = await actor.supabase.from("os_documents").select("*").eq("id", documentId).maybeSingle();
  if (error || !data || !(await readableKnowledgePages(actor, [data])).has(documentId)) {
    throw new ApiError(404, "KNOWLEDGE_ASSET_DOCUMENT_NOT_FOUND", "이미지가 연결된 문서를 열 수 없습니다.");
  }
  return data;
}

async function readableDocumentIds(actor: RequestActor, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const { data, error } = await actor.supabase.from("os_documents").select("*").in("id", ids);
  if (error) throw new ApiError(400, "KNOWLEDGE_ASSET_DOCUMENT_LIST_FAILED", "문서 접근 권한을 확인하지 못했습니다.");
  return readableKnowledgePages(actor, data ?? []);
}

async function assertEditableDocument(actor: RequestActor, documentId: string) {
  const document = await readableDocument(actor, documentId);
  const editable = actor.role === "admin" || document.status === "canonical" || (document.owner_id === actor.id && document.status !== "archived");
  if (!editable) throw new ApiError(403, "KNOWLEDGE_ASSET_FORBIDDEN", "이 문서의 이미지를 연결할 권한이 없습니다.");
  return document;
}

function isMissingTable(error: { code?: string; message?: string } | null) {
  return error?.code === "42P01" || error?.code === "PGRST205" || Boolean(error?.message?.includes("os_knowledge_assets"));
}

async function signedUrl(path: string) {
  const { data, error } = await createServiceSupabase().storage.from(KNOWLEDGE_ATTACHMENT_BUCKET).createSignedUrl(path, 900);
  return error || !data ? "" : data.signedUrl;
}

async function loadRows(actor: RequestActor, documentIds: string[]) {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; offset < documentIds.length; offset += 50) {
    const { data, error } = await actor.supabase.from("os_knowledge_assets").select("*").in("document_id", documentIds.slice(offset, offset + 50));
    if (isMissingTable(error)) return [];
    if (error) throw new ApiError(400, "KNOWLEDGE_ASSET_LIST_FAILED", "이미지 연결 정보를 불러오지 못했습니다.", error.message);
    rows.push(...(data ?? []));
  }
  return rows;
}

async function missingReferences(actor: RequestActor, url: URL) {
  const folder = (url.searchParams.get("folder") ?? "").trim();
  const documents: KnowledgeDocument[] = [];
  const exactFolder = url.searchParams.has("folder");
  for (let offset = 0; offset < 10_000; offset += 200) {
    let builder = actor.supabase.from("os_documents")
      .select("*")
      .neq("status", "archived")
      .order("updated_at", { ascending: false })
      .range(offset, offset + 199);
    if (exactFolder) builder = builder.eq("folder", folder === "분류 없음" ? "" : folder);
    const { data, error } = await builder;
    if (error) throw new ApiError(400, "KNOWLEDGE_ASSET_DOCUMENT_LIST_FAILED", "이미지를 복원할 문서를 불러오지 못했습니다.", error.message);
    documents.push(...(data ?? []));
    if (!data || data.length < 200) break;
  }
  const readable = await readableKnowledgePages(actor, documents);
  const visibleDocuments = documents.filter((document) => readable.has(document.id));
  const ids = visibleDocuments.map((document) => document.id);
  const linked = new Set<string>();
  const linkedRows = await loadRows(actor, ids);
  for (let offset = 0; offset < linkedRows.length; offset += 25) {
    const checked = await Promise.all(linkedRows.slice(offset, offset + 25).map(async (row) => ({
      row,
      url: await signedUrl(String(row.storage_path)),
    })));
    for (const { row, url: objectExists } of checked) {
      if (objectExists) linked.add(`${row.document_id}:${row.reference_key}`);
    }
  }
  return visibleDocuments.flatMap((document) => knowledgeAssetReferences(document.content_md).map((reference) => ({
    documentId: document.id,
    documentTitle: document.title,
    documentFolder: document.folder,
    sourceDocument: document.source_ref ?? "",
    ...reference,
  })).filter((reference) => !linked.has(`${document.id}:${reference.referenceKey}`)));
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const url = new URL(request.url);
    if (url.searchParams.get("missing") === "true") {
      return NextResponse.json({ references: await missingReferences(actor, url) }, { headers });
    }
    const rawIds = url.searchParams.get("documentIds")?.split(",").filter(Boolean) ?? [url.searchParams.get("documentId") ?? ""];
    const documentIds = documentIdsSchema.parse(rawIds);
    const readable = await readableDocumentIds(actor, documentIds);
    const visibleIds = documentIds.filter((id) => readable.has(id));
    const reference = url.searchParams.get("reference") ? knowledgeAssetReferenceSchema.parse(url.searchParams.get("reference")) : "";
    let rows = await loadRows(actor, visibleIds);
    if (reference) {
      const key = normalizeKnowledgeAssetReference(reference);
      rows = rows.filter((row) => row.reference_key === key);
    }
    const urls = new Map<string, string>();
    await Promise.all([...new Set(rows.map((row) => String(row.storage_path)))].map(async (path) => urls.set(path, await signedUrl(path))));
    let assets = rows.map((row) => knowledgeAssetRow(row, urls.get(String(row.storage_path)) ?? "")).filter((asset) => asset.url);

    if (url.searchParams.get("covers") === "true") {
      const { data: documents, error } = visibleIds.length
        ? await actor.supabase.from("os_documents").select("id,content_md").in("id", visibleIds)
        : { data: [], error: null };
      if (error) throw new ApiError(400, "KNOWLEDGE_ASSET_COVER_FAILED", "문서 대표 이미지를 확인하지 못했습니다.", error.message);
      const mapped = new Map(assets.map((asset) => [`${asset.documentId}:${asset.referenceKey}`, asset]));
      const covers: KnowledgeAsset[] = [];
      for (const document of documents ?? []) {
        const candidates: Array<{ position: number; asset: KnowledgeAsset }> = [];
        for (const reference of knowledgeAssetReferences(document.content_md)) {
          const asset = mapped.get(`${document.id}:${reference.referenceKey}`);
          if (asset?.url) candidates.push({ position: Math.max(0, document.content_md.indexOf(reference.reference)), asset });
        }
        const nativePattern = /!\[[^\]]*\]\((knowledge-attachment:\?[^)]+)\)/g;
        for (const match of document.content_md.matchAll(nativePattern)) {
          const native = parseKnowledgeAttachmentTarget(match[1]);
          if (!native?.type.startsWith("image/") || knowledgeAttachmentDocumentId(native.path) !== document.id) continue;
          const signed = await signedUrl(native.path);
          if (!signed) continue;
          candidates.push({ position: match.index ?? Number.MAX_SAFE_INTEGER, asset: {
            id: `native:${native.path}`, documentId: document.id, reference: native.name,
            referenceKey: normalizeKnowledgeAssetReference(native.name), fileName: native.name,
            fileSize: native.size ?? 0, mimeType: native.type, storagePath: native.path,
            sha256: null, sourceDocument: "", fileCreatedAt: null, createdAt: "", updatedAt: "",
            url: signed, expiresIn: 900, nativeAttachment: true,
          } });
        }
        candidates.sort((a, b) => a.position - b.position);
        if (candidates[0]) covers.push(candidates[0].asset);
      }
      const coverIds = new Set(covers.map((asset) => asset.id));
      assets = [...covers, ...assets.filter((asset) => !coverIds.has(asset.id))];
    }
    return NextResponse.json({ assets }, { headers });
  } catch (error) { return respondError(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = knowledgeAssetPrepareSchema.parse(await parseJson(request, 8_000));
    await assertEditableDocument(actor, input.documentId);
    const referenceKey = normalizeKnowledgeAssetReference(input.reference);
    const service = createServiceSupabase();
    const { data: duplicate, error: duplicateError } = await service.from("os_knowledge_assets").select("*")
      .eq("document_id", input.documentId).eq("sha256", input.sha256.toLowerCase()).limit(1).maybeSingle();
    if (isMissingTable(duplicateError)) throw new ApiError(503, "KNOWLEDGE_ASSET_MIGRATION_REQUIRED", "이미지 복원 저장소 준비가 필요합니다.");
    if (duplicateError) throw new ApiError(400, "KNOWLEDGE_ASSET_DUPLICATE_CHECK_FAILED", "중복 이미지를 확인하지 못했습니다.", duplicateError.message);
    if (duplicate && await signedUrl(duplicate.storage_path)) {
      const { data, error } = await service.from("os_knowledge_assets").upsert({
        document_id: input.documentId, reference: input.reference, reference_key: referenceKey,
        file_name: input.fileName, file_size: input.fileSize, mime_type: input.mimeType,
        storage_path: duplicate.storage_path, sha256: input.sha256.toLowerCase(),
        source_document: input.sourceDocument, file_created_at: input.fileCreatedAt, created_by: actor.id,
      }, { onConflict: "document_id,reference_key" }).select("*").single();
      if (error || !data) throw new ApiError(400, "KNOWLEDGE_ASSET_LINK_FAILED", "중복 이미지를 문서에 연결하지 못했습니다.", error?.message);
      return NextResponse.json({ asset: knowledgeAssetRow(data, await signedUrl(data.storage_path)), duplicate: true }, { status: 200, headers });
    }
    const extension = KNOWLEDGE_ASSET_IMAGE_TYPES[input.mimeType];
    const path = `documents/${input.documentId}/${actor.id}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extension}`;
    const { data, error } = await service.storage.from(KNOWLEDGE_ATTACHMENT_BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new ApiError(400, "KNOWLEDGE_ASSET_SIGN_FAILED", "이미지 업로드 경로를 만들지 못했습니다.", error?.message);
    await registerPendingKnowledgeAttachment({ path, documentId: input.documentId, uploaderId: actor.id });
    return NextResponse.json({ upload: { path, token: data.token, type: input.mimeType }, duplicate: false }, { status: 201, headers });
  } catch (error) { return respondError(error); }
}

export async function PATCH(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = knowledgeAssetFinalizeSchema.parse(await parseJson(request, 8_000));
    await assertEditableDocument(actor, input.documentId);
    if (knowledgeAttachmentDocumentId(input.path) !== input.documentId || (knowledgeAttachmentUploaderId(input.path) !== actor.id && actor.role !== "admin")) {
      throw new ApiError(403, "KNOWLEDGE_ASSET_PATH_FORBIDDEN", "이 이미지 업로드 경로를 사용할 권한이 없습니다.");
    }
    const service = createServiceSupabase();
    const { data: pending, error: pendingError } = await service.from("os_knowledge_attachment_uploads").select("path,status,uploader_id,document_id")
      .eq("path", input.path).eq("document_id", input.documentId).maybeSingle();
    if (pendingError || !pending || pending.status !== "pending") throw new ApiError(409, "KNOWLEDGE_ASSET_UPLOAD_EXPIRED", "이미지 업로드가 만료되었거나 이미 처리되었습니다.");
    if (pending.uploader_id !== actor.id && actor.role !== "admin") throw new ApiError(403, "KNOWLEDGE_ASSET_UPLOAD_FORBIDDEN", "다른 사람이 올린 이미지를 연결할 수 없습니다.");
    const parts = input.path.split("/");
    const name = parts.pop()!;
    const { data: objects, error: listError } = await service.storage.from(KNOWLEDGE_ATTACHMENT_BUCKET).list(parts.join("/"), { search: name, limit: 10 });
    if (listError || !objects?.some((object) => object.name === name)) throw new ApiError(409, "KNOWLEDGE_ASSET_UPLOAD_MISSING", "업로드한 이미지가 확인되지 않습니다. 다시 올려 주세요.");
    const { data, error } = await service.from("os_knowledge_assets").upsert({
      document_id: input.documentId, reference: input.reference,
      reference_key: normalizeKnowledgeAssetReference(input.reference), file_name: input.fileName,
      file_size: input.fileSize, mime_type: input.mimeType, storage_path: input.path,
      sha256: input.sha256.toLowerCase(), source_document: input.sourceDocument,
      file_created_at: input.fileCreatedAt, created_by: actor.id,
    }, { onConflict: "document_id,reference_key" }).select("*").single();
    if (error?.message?.includes("OS_ATTACHMENT_EXPIRED")) throw new ApiError(409, "KNOWLEDGE_ASSET_UPLOAD_EXPIRED", "이미지 보관 시간이 지나 연결하지 못했습니다. 다시 올려 주세요.");
    if (error || !data) throw new ApiError(400, "KNOWLEDGE_ASSET_LINK_FAILED", "이미지를 문서에 연결하지 못했습니다.", error?.message);
    return NextResponse.json({ asset: knowledgeAssetRow(data, await signedUrl(data.storage_path)), duplicate: false }, { headers });
  } catch (error) { return respondError(error); }
}

function respondError(error: unknown) {
  if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_KNOWLEDGE_ASSET", "이미지 연결 정보를 확인해 주세요.", error.flatten()));
  return apiErrorResponse(error);
}
