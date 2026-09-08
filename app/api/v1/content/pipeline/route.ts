import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { readPipeline, reviewPipeline } from "@/lib/server/content-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const id = z.string().uuid().parse(new URL(request.url).searchParams.get("sourceId"));
    return NextResponse.json(await readPipeline(actor, id));
  } catch (error) { return apiErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = z.object({ sourceId: z.string().uuid(), gate: z.number().int().min(1).max(3), signature: z.string().length(64), approved: z.boolean(), note: z.string().trim().max(2000).default("") }).parse(await parseJson(request));
    return NextResponse.json({ record: await reviewPipeline(actor, input.sourceId, input.gate, input.signature, input.approved, input.note) });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_REVIEW", "승인 내용을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
