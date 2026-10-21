import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { actOnFeedback, createFeedback, feedbackActionSchema, feedbackCreateSchema, listFeedback } from "@/lib/server/youtube-process-feedback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
const projectId = z.string().uuid();
const invalid = (error: unknown) => error instanceof ZodError ? apiErrorResponse(new ApiError(400, "INVALID_FEEDBACK", error.issues[0]?.message || "피드백 내용을 확인해 주세요.")) : apiErrorResponse(error);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await youtubeActor(request);
    return NextResponse.json({ items: await listFeedback(actor, projectId.parse((await params).id)) }, { headers });
  } catch (error) { return invalid(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const input = feedbackCreateSchema.parse(await parseJson(request, 8_000));
    return NextResponse.json({ item: await createFeedback(actor, projectId.parse((await params).id), input) }, { status: 201, headers });
  } catch (error) { return invalid(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const input = feedbackActionSchema.parse(await parseJson(request, 4_000));
    return NextResponse.json({ item: await actOnFeedback(actor, projectId.parse((await params).id), input) }, { headers });
  } catch (error) { return invalid(error); }
}
