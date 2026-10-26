import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { DEFAULT_COST_MODELS, type CostModels } from "@/lib/cost";
import { MYIN_VOICE_MODEL } from "@/lib/server/myin-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The models the paid buttons use, read the same way the routes that call them read them, so a cost popup names the real one. */
export async function GET(request: Request) {
  try {
    await authenticateRequest(request);
    const env = process.env;
    const models: CostModels = {
      voice: env.FISH_TTS_MODEL?.trim() || DEFAULT_COST_MODELS.voice,
      myinVoice: MYIN_VOICE_MODEL,
      haiku: env.CLAUDE_HAIKU_MODEL || DEFAULT_COST_MODELS.haiku,
      sonnet: env.CLAUDE_SONNET_MODEL || DEFAULT_COST_MODELS.sonnet,
      transcribe: env.OPENAI_TRANSCRIPTION_MODEL || DEFAULT_COST_MODELS.transcribe,
    };
    return NextResponse.json({ models });
  } catch (error) { return apiErrorResponse(error); }
}
