import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { addCardCharacter, characterAddSchema, listCardCharacters, removeCardCharacter } from "@/lib/server/card-draw";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "cache-control": "private, no-store" };

/** 캐릭터 창고: the pictures 카드 그림 draws the same characters from. */
export async function GET(request: Request) {
  try {
    await youtubeActor(request);
    return NextResponse.json({ characters: await listCardCharacters() }, { headers });
  } catch (error) { return apiErrorResponse(error); }
}

/** 캐릭터로 저장: a picture on one of the project's cards, under a name. */
export async function POST(request: Request) {
  try {
    const actor = await youtubeActor(request);
    return NextResponse.json({ characters: await addCardCharacter(actor, characterAddSchema.parse(await parseJson(request, 2_000))) }, { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_CARD_CHARACTER", "캐릭터 이름을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await youtubeActor(request);
    const id = z.string().uuid().parse(new URL(request.url).searchParams.get("id"));
    return NextResponse.json({ characters: await removeCardCharacter(actor, id) }, { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_CARD_CHARACTER", "뺄 캐릭터 그림을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
