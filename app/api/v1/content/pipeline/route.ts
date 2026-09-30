import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { readPipeline, reviewPipeline, reviewProductionStep, reviewScript, reviewWritingPreparation, saveScriptReview, saveWritingPreparation } from "@/lib/server/content-pipeline";
import { PRODUCTION_WORKFLOW_STEPS } from "@/lib/content-production-workflow";
import { SCRIPT_REVIEW_STEPS } from "@/lib/content-script-review";
import { WRITING_WORKFLOW_STEPS } from "@/lib/content-writing-workflow";

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
    const body = await parseJson(request);
    const operation = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).operation : undefined;
    if (operation === "writing_save") {
      const input = z.object({ operation: z.literal("writing_save"), sourceId: z.string().uuid(), expectedVersion: z.number().int().positive(), step: z.enum(["materials", "axis", "design"]), content: z.string().trim().min(1).max(30_000) }).parse(body);
      return NextResponse.json({ record: await saveWritingPreparation(actor, input.sourceId, input.expectedVersion, input.step, input.content) });
    }
    if (operation === "writing_review") {
      const input = z.object({ operation: z.literal("writing_review"), sourceId: z.string().uuid(), expectedVersion: z.number().int().positive(), step: z.enum(WRITING_WORKFLOW_STEPS), approved: z.boolean(), note: z.string().trim().max(2000).default("") }).parse(body);
      return NextResponse.json({ record: await reviewWritingPreparation(actor, input.sourceId, input.expectedVersion, input.step, input.approved, input.note) });
    }
    if (operation === "script_review_save") {
      const input = z.object({ operation: z.literal("script_review_save"), sourceId: z.string().uuid(), expectedVersion: z.number().int().positive(), step: z.enum(SCRIPT_REVIEW_STEPS), content: z.string().trim().min(1).max(10_000) }).parse(body);
      return NextResponse.json({ record: await saveScriptReview(actor, input.sourceId, input.expectedVersion, input.step, input.content) });
    }
    if (operation === "script_review_decide") {
      const input = z.object({ operation: z.literal("script_review_decide"), sourceId: z.string().uuid(), expectedVersion: z.number().int().positive(), step: z.enum(SCRIPT_REVIEW_STEPS), approved: z.boolean(), note: z.string().trim().max(2000).default("") }).parse(body);
      return NextResponse.json({ record: await reviewScript(actor, input.sourceId, input.expectedVersion, input.step, input.approved, input.note) });
    }
    if (operation === "production_review") {
      const input = z.object({ operation: z.literal("production_review"), sourceId: z.string().uuid(), expectedVersion: z.number().int().positive(), step: z.enum(PRODUCTION_WORKFLOW_STEPS), approved: z.boolean(), note: z.string().trim().max(2000).default("") }).parse(body);
      return NextResponse.json({ record: await reviewProductionStep(actor, input.sourceId, input.expectedVersion, input.step, input.approved, input.note) });
    }
    const input = z.object({ sourceId: z.string().uuid(), gate: z.number().int().min(1).max(3), signature: z.string().length(64), approved: z.boolean(), note: z.string().trim().max(2000).default("") }).parse(body);
    return NextResponse.json({ record: await reviewPipeline(actor, input.sourceId, input.gate, input.signature, input.approved, input.note) });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_REVIEW", "승인 내용을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
