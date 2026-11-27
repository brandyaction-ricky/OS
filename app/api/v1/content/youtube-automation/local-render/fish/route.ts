import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { localFishVoice } from "@/lib/server/myin-run";
import { canUseYoutubeAutomationPilot } from "@/lib/youtube-automation-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One sentence take; the engine's own wait for Fish is 300 s.
export const maxDuration = 300;

const query = z.object({ run: z.string().uuid(), lease: z.string().uuid() });
// What Logan's stage_voice.tts sends Fish, nothing more.
const body = z.object({
  text: z.string().trim().min(1).max(3_000), format: z.literal("wav"), reference_id: z.string().min(1).max(64),
  temperature: z.number().min(0).max(2).optional(), top_p: z.number().min(0).max(1).optional(),
  prosody: z.object({ speed: z.number().min(0.5).max(2), volume: z.number().min(-20).max(20) }).strict().optional(),
}).strict();

/**
 * 키 없이 Fish (로건 요청 11-16 · 2단계): a staff computer making the voice it leased sends the engine's Fish request here with its 「내 컴퓨터
 * 연결」 key (FISH_TTS_URL); the OS calls Fish with the company key and hands the sound back. Only that video's voice, only while its lease holds.
 */
export async function POST(request: Request) {
  try {
    if (!canUseYoutubeAutomationPilot(process.env)) throw new ApiError(404, "AUTOMATION_PILOT_DISABLED", "영상 자동화 파일럿이 아직 연결되지 않았습니다.");
    const actor = await authenticateRequest(request, { allowAgent: true, requiredAgentScope: "records.write" });
    if (actor.type !== "agent") throw new ApiError(403, "LOCAL_RENDER_KEY_REQUIRED", "「내 컴퓨터 연결」 키로만 쓸 수 있어요.");
    const url = new URL(request.url);
    const where = query.parse({ run: url.searchParams.get("run"), lease: url.searchParams.get("lease") });
    const input = body.parse(await parseJson(request, 20_000));
    const fish = await localFishVoice(actor.ownerId, where.run, where.lease);
    if (input.reference_id !== fish.referenceId) throw new ApiError(403, "MYIN_FISH_VOICE_MISMATCH", "이 영상의 목소리가 아니에요.");
    const upstream = await fetch("https://api.fish.audio/v1/tts", {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(280_000),
      headers: { authorization: `Bearer ${fish.apiKey}`, "content-type": "application/json", model: fish.model }, body: JSON.stringify(input),
    });
    // The engine waits and asks again on 408 · 429 · 5xx; anything else stops that sentence.
    if (!upstream.ok || !upstream.body) return new Response(null, { status: upstream.status === 408 || upstream.status === 429 || upstream.status >= 500 ? upstream.status : 502 });
    return new Response(upstream.body, { headers: { "content-type": upstream.headers.get("content-type") ?? "audio/wav", "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_LOCAL_FISH_REQUEST", "음성 요청을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
