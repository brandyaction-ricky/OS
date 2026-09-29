import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import {
  KNOWLEDGE_ATTACHMENT_BUCKET,
  KNOWLEDGE_ATTACHMENT_TYPES,
  knowledgeAttachmentCreateSchema,
  knowledgeAttachmentDocumentId,
  knowledgeAttachmentPathSchema,
  knowledgeAttachmentUploaderId,
} from "@/lib/knowledge-attachments";
import { authenticateRequest, type RequestActor } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

async function readableDocument(actor: RequestActor, documentId: string) {
  const { data, error } = await actor.supabase.from("os_documents").select("id,owner_id,status").eq("id", documentId).maybeSingle();
  if (error || !data) throw new ApiError(404, "KNOWLEDGE_ATTACHMENT_DOCUMENT_NOT_FOUND", "첨부 자료가 연결된 문서를 열 수 없습니다.");
  return data;
}

async function assertEditableDocument(actor: RequestActor, documentId: string) {
  const document = await readableDocument(actor, documentId);
  const editable = actor.role === "admin" || document.status === "canonical" || (document.owner_id === actor.id && document.status !== "archived");
  if (!editable) throw new ApiError(403, "KNOWLEDGE_ATTACHMENT_FORBIDDEN", "이 문서에 자료를 첨부할 권한이 없습니다.");
}

function respondError(error: unknown) {
  if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_KNOWLEDGE_ATTACHMENT", "첨부할 자료를 확인해 주세요.", error.flatten()));
  return apiErrorResponse(error);
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = knowledgeAttachmentCreateSchema.parse(await parseJson(request, 4_000));
    await assertEditableDocument(actor, input.documentId);
    const extension = KNOWLEDGE_ATTACHMENT_TYPES[input.mimeType];
    const path = `documents/${input.documentId}/${actor.id}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extension}`;
    const { data, error } = await createServiceSupabase().storage.from(KNOWLEDGE_ATTACHMENT_BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new ApiError(400, "KNOWLEDGE_ATTACHMENT_SIGN_FAILED", "자료 업로드 경로를 만들지 못했습니다.", error?.message);
    return NextResponse.json({ path, token: data.token, name: input.fileName, size: input.fileSize, type: input.mimeType }, { status: 201, headers });
  } catch (error) { return respondError(error); }
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const path = knowledgeAttachmentPathSchema.parse(new URL(request.url).searchParams.get("path") ?? "");
    await readableDocument(actor, knowledgeAttachmentDocumentId(path));
    const { data, error } = await createServiceSupabase().storage.from(KNOWLEDGE_ATTACHMENT_BUCKET).createSignedUrl(path, 900);
    if (error || !data) throw new ApiError(404, "KNOWLEDGE_ATTACHMENT_NOT_FOUND", "첨부 자료를 찾지 못했습니다.");
    return NextResponse.json({ url: data.signedUrl, expiresIn: 900 }, { headers });
  } catch (error) { return respondError(error); }
}

export async function DELETE(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const path = knowledgeAttachmentPathSchema.parse(new URL(request.url).searchParams.get("path") ?? "");
    await assertEditableDocument(actor, knowledgeAttachmentDocumentId(path));
    if (knowledgeAttachmentUploaderId(path) !== actor.id && actor.role !== "admin") {
      throw new ApiError(403, "KNOWLEDGE_ATTACHMENT_DELETE_FORBIDDEN", "이 첨부 자료를 삭제할 권한이 없습니다.");
    }
    const { error } = await createServiceSupabase().storage.from(KNOWLEDGE_ATTACHMENT_BUCKET).remove([path]);
    if (error) throw new ApiError(400, "KNOWLEDGE_ATTACHMENT_DELETE_FAILED", "첨부 자료를 삭제하지 못했습니다.", error.message);
    return NextResponse.json({ deleted: true }, { headers });
  } catch (error) { return respondError(error); }
}
