import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { updateUtmOption, utmActor, utmOptionUpdateSchema } from "@/lib/server/utm-links";

export const runtime = "nodejs";

/** Admins rename a shared choice or turn it off/on; the code never changes. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await utmActor(request);
    const { id } = await params;
    return NextResponse.json(await updateUtmOption(id, utmOptionUpdateSchema.parse(await parseJson(request, 4_000)), actor), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "UTM_OPTION_INVALID", "바꿀 내용을 다시 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
