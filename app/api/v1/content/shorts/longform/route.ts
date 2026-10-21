import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { readShortformLongform } from "@/lib/server/shortform-longform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const querySchema = z.object({ sourceId: z.string().uuid(), expectedKey: z.string().regex(/^[a-f0-9]{64}$/).optional() });

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const params = new URL(request.url).searchParams;
    const input = querySchema.parse({ sourceId: params.get("sourceId"), expectedKey: params.get("expectedKey") ?? undefined });
    return NextResponse.json(await readShortformLongform(actor, input.sourceId, input.expectedKey), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_SHORTFORM_SOURCE", "기준 콘텐츠를 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
