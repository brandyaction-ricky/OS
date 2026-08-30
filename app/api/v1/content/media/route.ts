import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "os-content-media";
const MAX_BYTES = 5 * 1024 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-m4v": "m4v",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
};

async function contentStorage() {
  const service = createServiceSupabase();
  const { data } = await service.storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await service.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: MAX_BYTES,
      allowedMimeTypes: Object.keys(EXTENSIONS),
    });
    if (error && !/already exists/i.test(error.message)) throw error;
  }
  return service.storage.from(BUCKET);
}

const createSchema = z.object({
  sourceId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(240),
  fileSize: z.number().int().positive().max(MAX_BYTES),
  mimeType: z.enum(["video/mp4", "video/quicktime", "video/x-m4v", "video/webm", "video/x-matroska"]),
});

const pathSchema = z.string().regex(/^originals\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9]{13}-[0-9a-f-]{36}\.(mp4|mov|m4v|webm|mkv)$/);

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = createSchema.parse(await parseJson(request));
    const { data: source } = await actor.supabase.from("os_records").select("id,record_type").eq("id", input.sourceId).is("archived_at", null).maybeSingle();
    if (!source || source.record_type !== "content_topic") throw new ApiError(404, "CONTENT_SOURCE_NOT_FOUND", "원본 콘텐츠를 찾지 못했습니다.");
    const path = `originals/${actor.id}/${input.sourceId}/${Date.now()}-${randomUUID()}.${EXTENSIONS[input.mimeType]}`;
    const { data, error } = await (await contentStorage()).createSignedUploadUrl(path);
    if (error || !data) throw new ApiError(400, "CONTENT_MEDIA_SIGN_FAILED", "영상 업로드 경로를 만들지 못했습니다.", error?.message);
    return NextResponse.json({ path, token: data.token, fileName: input.fileName, fileSize: input.fileSize, mimeType: input.mimeType, retentionHours: 24 });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_CONTENT_MEDIA", "영상 파일 정보를 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const path = pathSchema.parse(new URL(request.url).searchParams.get("path") ?? "");
    const ownerId = path.split("/")[1];
    if (ownerId !== actor.id && actor.role !== "admin") throw new ApiError(403, "CONTENT_MEDIA_FORBIDDEN", "이 영상 원본을 열 권한이 없습니다.");
    const { data, error } = await createServiceSupabase().storage.from(BUCKET).createSignedUrl(path, 3_600);
    if (error || !data) throw new ApiError(404, "CONTENT_MEDIA_NOT_FOUND", "영상 원본을 찾지 못했습니다.");
    return NextResponse.json({ url: data.signedUrl, expiresIn: 3_600 });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_CONTENT_MEDIA_PATH", "영상 저장 경로가 올바르지 않습니다."));
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const path = pathSchema.parse(new URL(request.url).searchParams.get("path") ?? "");
    const ownerId = path.split("/")[1];
    if (ownerId !== actor.id && actor.role !== "admin") throw new ApiError(403, "CONTENT_MEDIA_FORBIDDEN", "이 영상 원본을 삭제할 권한이 없습니다.");
    const { error } = await createServiceSupabase().storage.from(BUCKET).remove([path]);
    if (error) throw new ApiError(400, "CONTENT_MEDIA_DELETE_FAILED", "영상 원본을 삭제하지 못했습니다.", error.message);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_CONTENT_MEDIA_PATH", "영상 저장 경로가 올바르지 않습니다."));
    return apiErrorResponse(error);
  }
}
