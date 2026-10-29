import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { safeSecretMatch } from "@/lib/server/auth";
import { processEmbeddingQueue } from "@/lib/server/indexing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Night search indexing (owner 2026-10-29, 속도 (나)): every hour 01:00–05:00 KST, one document at a time. */
export async function GET(request: Request) {
  try {
    const expected = process.env.CRON_SECRET ?? "";
    const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!expected || !safeSecretMatch(received, expected)) throw new ApiError(401, "INVALID_CRON_SECRET", "예약 작업 인증에 실패했습니다.");
    if (!process.env.OPENAI_API_KEY) return NextResponse.json({ ok: true, skipped: "embeddings_not_configured" });
    return NextResponse.json({ ok: true, ...await processEmbeddingQueue({ limit: 100, deadlineMs: 250_000 }) });
  } catch (error) { return apiErrorResponse(error); }
}
