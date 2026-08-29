import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await authenticateRequest(request);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new ApiError(503, "TRANSCRIPTION_NOT_CONFIGURED", "AI 전사 키가 아직 연결되지 않았습니다. 원문은 직접 입력할 수 있습니다.");
    const input = await request.formData();
    const file = input.get("file");
    if (!(file instanceof File) || file.size < 1) throw new ApiError(400, "AUDIO_REQUIRED", "전사할 녹음 파일이 필요합니다.");
    if (file.size > 4_000_000) throw new ApiError(413, "AUDIO_TOO_LARGE", "녹음은 4MB 이하만 전사할 수 있습니다.");
    const body = new FormData();
    body.set("file", file, file.name || `meeting-${Date.now()}.webm`);
    body.set("model", process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe");
    body.set("language", "ko");
    body.set("response_format", "json");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body, signal: controller.signal });
      const result = await response.json() as { text?: string; error?: { message?: string } };
      if (!response.ok || !result.text?.trim()) throw new ApiError(502, "TRANSCRIPTION_FAILED", "녹음을 전사하지 못했습니다.", result.error?.message);
      return NextResponse.json({ transcript: result.text.trim(), mode: "ai" });
    } finally { clearTimeout(timeout); }
  } catch (error) { return apiErrorResponse(error); }
}
