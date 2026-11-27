import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { cardCanon, MYIN_CANON_TITLES, VOICE_CANON_TITLE } from "@/lib/server/youtube-process-card-job";
import { namedProcedures } from "@/lib/server/content-generation";
import { youtubeActor } from "@/lib/server/youtube-process";
import { cardCreateSchema, createCardProject, listCardSources, readCardCovers } from "@/lib/server/youtube-process-cards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await youtubeActor(request);
    const params = new URL(request.url).searchParams;
    if (params.has("canon")) {
      const [canon, voice] = await Promise.all([cardCanon(actor.supabase), namedProcedures(actor.supabase, [VOICE_CANON_TITLE, ...MYIN_CANON_TITLES])]);
      const originals = await actor.supabase.from("os_documents").select("id,title,content_md,current_version").in("id", [...(canon ? [canon.id] : []), ...voice.map(doc => doc.id)]);
      if (originals.error) throw new ApiError(503, "CARD_CANON_UNAVAILABLE", "정본 원문을 읽지 못했어요.");
      return NextResponse.json({ canon, voice: voice.find(doc => doc.title === VOICE_CANON_TITLE) ?? null, originals: originals.data ?? [] }, { headers: { "cache-control": "private, no-store" } });
    }
    const result = params.has("covers")
      ? { covers: await readCardCovers(actor, z.array(z.string().uuid()).max(40).parse((params.get("covers") ?? "").split(",").filter(Boolean))) }
      : { sources: await listCardSources(actor) };
    return NextResponse.json(result, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_CARD_QUERY", "불러올 카드뉴스를 확인해 주세요."));
    return apiErrorResponse(error);
  }
}

/** A new 카드뉴스: from a topic (주제 찾기 › 카드뉴스), a finished longform · 숏폼, or an approved Threads post. */
export async function POST(request: Request) {
  try {
    const actor = await youtubeActor(request);
    const input = cardCreateSchema.parse(await parseJson(request, 10_000));
    return NextResponse.json({ project: await createCardProject(actor, input) }, { status: 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_CARD", "입력 내용을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
