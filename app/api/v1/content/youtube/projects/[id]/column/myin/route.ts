import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { columnToMyin, myinColumnSchema } from "@/lib/server/youtube-process-stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Images are read from storage and sent on; give MYIN time to store them.
export const maxDuration = 60;

/** One SEO 칼럼 to the MYIN 아티클: send (as a draft, or update), publish, or take back to draft. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const input = myinColumnSchema.parse(await parseJson(request, 2_000));
    return NextResponse.json(await columnToMyin(actor, z.string().uuid().parse((await params).id), input), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_MYIN_ACTION", "보낼 칼럼을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
