import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import {
  DEVELOPMENT_ATTACHMENT_BUCKET,
  DEVELOPMENT_ATTACHMENT_TYPES,
  developmentAttachmentCreateSchema,
  developmentAttachmentPathSchema,
} from "@/lib/development-attachments";
import { authenticateRequest, type RequestActor } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

function ownerFromPath(path: string) { return path.split("/")[1]; }
function assertOwner(actor: RequestActor, path: string) {
  if (ownerFromPath(path) !== actor.id && actor.role !== "admin") {
    throw new ApiError(403, "DEVELOPMENT_ATTACHMENT_FORBIDDEN", "이 첨부 자료를 변경할 권한이 없습니다.");
  }
}
function respondError(error: unknown) {
  if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_DEVELOPMENT_ATTACHMENT", "첨부할 자료를 확인해 주세요.", error.flatten()));
  return apiErrorResponse(error);
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = developmentAttachmentCreateSchema.parse(await parseJson(request, 4_000));
    const extension = DEVELOPMENT_ATTACHMENT_TYPES[input.mimeType];
    const path = `requests/${actor.id}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extension}`;
    const { data, error } = await createServiceSupabase().storage.from(DEVELOPMENT_ATTACHMENT_BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new ApiError(400, "DEVELOPMENT_ATTACHMENT_SIGN_FAILED", "자료 업로드 경로를 만들지 못했습니다.", error?.message);
    return NextResponse.json({ path, token: data.token, name: input.fileName, size: input.fileSize, type: input.mimeType }, { status: 201, headers });
  } catch (error) { return respondError(error); }
}

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);
    const path = developmentAttachmentPathSchema.parse(new URL(request.url).searchParams.get("path") ?? "");
    const { data, error } = await createServiceSupabase().storage.from(DEVELOPMENT_ATTACHMENT_BUCKET).createSignedUrl(path, 900);
    if (error || !data) throw new ApiError(404, "DEVELOPMENT_ATTACHMENT_NOT_FOUND", "첨부 자료를 찾지 못했습니다.");
    return NextResponse.json({ url: data.signedUrl, expiresIn: 900 }, { headers });
  } catch (error) { return respondError(error); }
}

export async function DELETE(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const path = developmentAttachmentPathSchema.parse(new URL(request.url).searchParams.get("path") ?? "");
    assertOwner(actor, path);
    const { error } = await createServiceSupabase().storage.from(DEVELOPMENT_ATTACHMENT_BUCKET).remove([path]);
    if (error) throw new ApiError(400, "DEVELOPMENT_ATTACHMENT_DELETE_FAILED", "첨부 자료를 삭제하지 못했습니다.", error.message);
    return NextResponse.json({ deleted: true }, { headers });
  } catch (error) { return respondError(error); }
}

