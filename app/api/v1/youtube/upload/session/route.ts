import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { getYoutubeAccessToken } from "@/lib/server/youtube-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({
  kitId: z.string().uuid(), fileName: z.string().trim().min(1).max(255),
  fileSize: z.number().int().positive().max(137_438_953_472),
  mimeType: z.string().regex(/^video\/[a-z0-9.+-]+$/i), privacyStatus: z.enum(["private", "unlisted"]),
  finalApproval: z.literal(true),
});

function lines(value: unknown) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : String(value ?? "").split("\n").map((item) => item.trim()).filter(Boolean);
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    if (actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 최종 승인된 영상을 업로드할 수 있습니다.");
    const input = inputSchema.parse(await parseJson(request, 20_000));
    const { data: kit, error } = await actor.supabase.from("os_records").select("id,title,record_type,metadata").eq("id", input.kitId).is("archived_at", null).maybeSingle();
    if (error) throw new ApiError(400, "YOUTUBE_KIT_READ_FAILED", "유튜브 발행 키트를 불러오지 못했습니다.", error.message);
    if (!kit || kit.record_type !== "content_package" || kit.metadata?.packageKind !== "youtube_kit") throw new ApiError(404, "YOUTUBE_KIT_NOT_FOUND", "유튜브 발행 키트를 찾지 못했습니다.");
    const result = (kit.metadata?.result ?? {}) as Record<string, unknown>;
    const title = String(result.title || kit.title).trim().slice(0, 100);
    if (!title) throw new ApiError(400, "YOUTUBE_TITLE_REQUIRED", "업로드 전에 영상 제목을 입력해 주세요.");
    const accessToken = await getYoutubeAccessToken(actor.id);
    const params = new URLSearchParams({ uploadType: "resumable", part: "snippet,status" });
    const google = await fetch(`https://www.googleapis.com/upload/youtube/v3/videos?${params}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`, "content-type": "application/json; charset=UTF-8",
        "x-upload-content-length": String(input.fileSize), "x-upload-content-type": input.mimeType,
      },
      body: JSON.stringify({
        snippet: { title, description: String(result.description ?? "").slice(0, 5000), tags: lines(result.tags).slice(0, 60), categoryId: "22" },
        status: { privacyStatus: input.privacyStatus, selfDeclaredMadeForKids: false },
      }), cache: "no-store",
    });
    const uploadUrl = google.headers.get("location");
    const body = uploadUrl ? null : await google.json().catch(() => ({})) as { error?: { message?: string } };
    if (!google.ok || !uploadUrl) throw new ApiError(502, "YOUTUBE_UPLOAD_SESSION_FAILED", "YouTube 업로드 세션을 만들지 못했습니다.", body?.error?.message);
    return NextResponse.json({ uploadUrl, kitId: kit.id, privacyStatus: input.privacyStatus, fileName: input.fileName });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_YOUTUBE_UPLOAD", "업로드 파일과 승인 내용을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
