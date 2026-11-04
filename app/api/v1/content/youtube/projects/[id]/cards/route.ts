import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { cardDrawSchema, drawCardImage } from "@/lib/server/card-draw";
import { checkCardsAgain, renderCards } from "@/lib/server/youtube-process-cards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 화면 자동 검사: every card drawn and read by GPT (one to three minutes); 카드 그림: one picture, up to two minutes.
export const maxDuration = 300;

const query = z.object({ draft: z.string().max(40).optional(), slide: z.coerce.number().int().min(0).max(19).optional(), zip: z.literal("1").optional(), upload: z.coerce.number().int().min(1).max(10).optional() });

/** One card as PNG (?slide=n) or all of them with the caption as a ZIP (?zip=1), drawn now from the saved cards. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const { id } = await params;
    const input = query.parse(Object.fromEntries(new URL(request.url).searchParams));
    const file = await renderCards(actor, z.string().uuid().parse(id), { draft: input.draft, slide: input.slide, zip: input.zip === "1", upload: input.upload });
    return new Response(file.body, { headers: { "content-type": file.type, "content-disposition": `attachment; filename="${file.name}"`, "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_CARD_QUERY", "요청을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}

const postBody = z.discriminatedUnion("action", [z.object({ action: z.literal("check"), tier: z.enum(["precise", "saving"]) }).strict(), cardDrawSchema]);

/** 최종 검토 › 화면 자동 검사 › [다시 검사]: GPT looks at the confirmed cards again. 카드 만들기 › AI로 그리기: GPT draws one picture. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const projectId = z.string().uuid().parse((await params).id);
    const input = postBody.parse(await parseJson(request, 4_000));
    const headers = { "cache-control": "private, no-store" };
    if (input.action === "draw") return Response.json({ photo: await drawCardImage(actor, projectId, input) }, { headers });
    return Response.json({ check: await checkCardsAgain(actor, projectId, input.tier) }, { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_CARD_CHECK", "요청을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
