import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { editVoiceDictionary, readVoiceDictionary, voiceDictionaryEditSchema } from "@/lib/server/youtube-voice-dictionary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };

/** 음성 사전 (로건 OS 요청 2026-10-30): the company's 읽기 사전 and 끊김 시험 문제, which the render PC reads at every voice job. */
export async function GET(request: Request) {
  try {
    await youtubeActor(request);
    const { dictionary, version } = await readVoiceDictionary();
    return NextResponse.json({ dictionary, version }, { headers });
  } catch (error) { return apiErrorResponse(error); }
}

/** One line added, changed, checked (맞음) or removed. */
export async function PATCH(request: Request) {
  try {
    const actor = await youtubeActor(request);
    return NextResponse.json(await editVoiceDictionary(actor, voiceDictionaryEditSchema.parse(await parseJson(request, 8_000))), { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "VOICE_DICTIONARY_INVALID", error.issues[0]?.message ?? "내용을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
