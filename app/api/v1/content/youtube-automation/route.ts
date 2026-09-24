import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { readYoutubeAutomationInput } from "@/lib/server/youtube-automation-input";
import { splitFishNarration, fishVoiceSettings, synthesizeFishSegment } from "@/lib/server/fish-audio";
import { canUseYoutubeAutomationPilot } from "@/lib/youtube-automation-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const inputSchema = z.object({ sourceId: z.string().uuid(), inputKey: z.string().length(64) }).strict();
const headers = { "cache-control": "private, no-store", vary: "Authorization" };

export async function GET(request: Request) {
  if (!canUseYoutubeAutomationPilot(process.env)) return NextResponse.json({ error: { code: "AUTOMATION_PILOT_DISABLED", message: "영상 자동화 파일럿이 아직 연결되지 않았습니다." } }, { status: 404 });
  try {
    const actor = await authenticateRequest(request, { allowAgent: false });
    const sourceId = z.string().uuid().parse(new URL(request.url).searchParams.get("sourceId"));
    const { state, plan } = await readYoutubeAutomationInput(actor.supabase, sourceId);
    if (state.source.owner_id !== actor.id) throw new ApiError(403, "CONTENT_OWNER_REQUIRED", "이 콘텐츠의 소유자만 자동 제작을 준비할 수 있습니다.");
    return NextResponse.json({ plan, voicePreviewConfigured: Boolean(process.env.FISH_API_KEY?.trim() && process.env.FISH_VOICE_REFERENCE_ID?.trim()) }, { headers });
  } catch (error) { return apiErrorResponse(error); }
}

/** Produces only the first narration paragraph for a private quality preview. No OS status is changed. */
export async function POST(request: Request) {
  if (!canUseYoutubeAutomationPilot(process.env)) return NextResponse.json({ error: { code: "AUTOMATION_PILOT_DISABLED", message: "영상 자동화 파일럿이 아직 연결되지 않았습니다." } }, { status: 404 });
  try {
    const actor = await authenticateRequest(request, { allowAgent: false });
    if (actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "목소리 미리듣기는 관리자만 실행할 수 있습니다.");
    const input = inputSchema.parse(await parseJson(request, 1_000));
    const { state, plan, scriptText } = await readYoutubeAutomationInput(actor.supabase, input.sourceId);
    if (state.source.owner_id !== actor.id) throw new ApiError(403, "CONTENT_OWNER_REQUIRED", "이 콘텐츠의 소유자만 목소리를 생성할 수 있습니다.");
    if (!plan.inputKey || plan.inputKey !== input.inputKey) throw new ApiError(409, "AUTOMATION_INPUT_CHANGED", "원고나 승인 상태가 변경됐습니다. 새로 불러와 주세요.");
    if (!scriptText) throw new ApiError(409, "AUTOMATION_SCRIPT_CHANGED", "현재 원고를 다시 확인해 주세요.");
    const first = splitFishNarration(scriptText)[0];
    const audio = await synthesizeFishSegment(first, { apiKey: process.env.FISH_API_KEY ?? "", referenceId: process.env.FISH_VOICE_REFERENCE_ID ?? "", model: process.env.FISH_TTS_MODEL, settings: fishVoiceSettings(process.env) });
    const latest = (await readYoutubeAutomationInput(actor.supabase, input.sourceId)).plan;
    if (latest.inputKey !== input.inputKey) throw new ApiError(409, "AUTOMATION_INPUT_CHANGED", "음성 생성 중 원고나 승인 상태가 변경됐습니다. 이 결과는 사용하지 않습니다.");
    return new Response(new Uint8Array(audio.bytes), { headers: { ...headers, "content-type": audio.mimeType, "content-disposition": "inline; filename=voice-preview.mp3" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_AUTOMATION_INPUT", "콘텐츠와 원고 버전을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
