import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { renderCards } from "@/lib/server/youtube-process-cards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const query = z.object({ draft: z.string().max(40).optional(), slide: z.coerce.number().int().min(0).max(19).optional(), zip: z.literal("1").optional() });

/** One card as PNG (?slide=n) or all of them with the caption as a ZIP (?zip=1), drawn now from the saved cards. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const { id } = await params;
    const input = query.parse(Object.fromEntries(new URL(request.url).searchParams));
    const file = await renderCards(actor, z.string().uuid().parse(id), { draft: input.draft, slide: input.slide, zip: input.zip === "1" });
    return new Response(file.body, { headers: { "content-type": file.type, "content-disposition": `attachment; filename="${file.name}"`, "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_CARD_QUERY", "요청을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
