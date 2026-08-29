import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "os-meeting-recordings";
const MAX_BYTES = 4_000_000;

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "RECORDING_REQUIRED", "회의 녹음 파일이 필요합니다.");
    if (!file.type.startsWith("audio/")) throw new ApiError(400, "INVALID_RECORDING", "오디오 파일만 업로드할 수 있습니다.");
    if (file.size <= 0 || file.size > MAX_BYTES) throw new ApiError(413, "RECORDING_TOO_LARGE", "회의 녹음은 4MB 이하로 나누어 업로드해 주세요.");
    const extension = file.type.includes("ogg") ? "ogg" : file.type.includes("mpeg") ? "mp3" : "webm";
    const path = `${actor.id}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extension}`;
    const { error } = await createServiceSupabase().storage.from(BUCKET).upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (error) throw new ApiError(400, "RECORDING_UPLOAD_FAILED", "회의 녹음을 저장하지 못했습니다.", error.message);
    return NextResponse.json({ path, size: file.size }, { status: 201 });
  } catch (error) { return apiErrorResponse(error); }
}

export async function GET(request: Request) {
  try {
    await authenticateRequest(request);
    const path = new URL(request.url).searchParams.get("path")?.trim() ?? "";
    if (!path || path.includes("..") || !/^[0-9a-f-]{36}\/[0-9]{4}-[0-9]{2}-[0-9]{2}\/[0-9a-f-]+\.(webm|ogg|mp3)$/.test(path)) {
      throw new ApiError(400, "INVALID_RECORDING_PATH", "회의 녹음 경로가 올바르지 않습니다.");
    }
    const { data, error } = await createServiceSupabase().storage.from(BUCKET).createSignedUrl(path, 3600);
    if (error || !data) throw new ApiError(404, "RECORDING_NOT_FOUND", "회의 녹음을 찾지 못했습니다.");
    return NextResponse.json({ url: data.signedUrl });
  } catch (error) { return apiErrorResponse(error); }
}
