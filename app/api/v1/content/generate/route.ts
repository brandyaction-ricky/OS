import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { executeGeneration, generationSchema } from "@/lib/server/content-generation";
import { runPipelineGeneration } from "@/lib/server/content-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = generationSchema.parse(await parseJson(request));
    const { data: source } = await actor.supabase.from("os_records").select("metadata").eq("id", input.sourceId).is("archived_at", null).maybeSingle();
    const result = source?.metadata?.pipelineEnabled === true ? await runPipelineGeneration(actor, input) : await executeGeneration(actor, input);
    return NextResponse.json(result, { status: result.queued ? 202 : 201 });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_CONTENT_GENERATION", "콘텐츠 생성 조건을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
