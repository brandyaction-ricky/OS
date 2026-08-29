import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { getEmbeddingQueueSummary, processEmbeddingQueue, retryFailedEmbeddingJobs } from "@/lib/server/indexing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const actionSchema = z.object({
  action: z.enum(["process", "retry_failed"]),
  limit: z.number().int().min(1).max(500).default(25),
});

async function requireAdmin(request: Request) {
  const actor = await authenticateRequest(request);
  if (actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 인덱싱 작업을 실행할 수 있습니다.");
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return NextResponse.json({
      queue: await getEmbeddingQueueSummary(),
      configured: Boolean(process.env.OPENAI_API_KEY),
      cronConfigured: Boolean(process.env.CRON_SECRET),
    });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const input = actionSchema.parse(await parseJson(request));
    if (input.action === "retry_failed") {
      const retried = await retryFailedEmbeddingJobs(input.limit);
      return NextResponse.json({ retried, queue: await getEmbeddingQueueSummary() });
    }
    if (!process.env.OPENAI_API_KEY) throw new ApiError(503, "EMBEDDINGS_NOT_CONFIGURED", "OpenAI 키가 등록되면 인덱싱을 실행할 수 있습니다.");
    return NextResponse.json({ result: await processEmbeddingQueue({ limit: Math.min(input.limit, 100), deadlineMs: 240_000 }) });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_INDEXING_ACTION", "인덱싱 요청을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
