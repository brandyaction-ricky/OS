import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { safeSecretMatch } from "@/lib/server/auth";
import { financeActor } from "@/lib/server/finance";
import { dailyTossSync } from "@/lib/server/finance-toss-sync";
import { logDailyRevenue } from "@/lib/server/kpi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Every morning: yesterday's Toss sales for 마이인 and 브랜디에듀 into the finance ledger.
// One business failing does not stop the other; each reports its own result.
async function run() {
  const deadline = Date.now() + 270_000, results = [];
  for (const biz of ["myin", "edu"] as const) {
    const share = Date.now() + (deadline - Date.now()) / (biz === "myin" ? 2 : 1);
    try { results.push(await dailyTossSync(biz, share)); }
    catch (error) { results.push({ biz, error: error instanceof ApiError ? error.code : "TOSS_DAILY_SYNC_FAILED" }); }
  }
  // Month-to-date sales into each business's KPI log, whatever the sync managed today.
  let kpiLog = "logged";
  try { await logDailyRevenue(); } catch (error) { kpiLog = error instanceof ApiError ? error.code : "KPI_LOG_FAILED"; }
  return NextResponse.json({ results, kpiLog }, { headers: { "Cache-Control": "no-store" } });
}
// Vercel Cron.
export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET || "", received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
    if (!secret || !safeSecretMatch(received, secret)) throw new ApiError(401, "INVALID_CRON_SECRET", "예약 작업 인증에 실패했습니다.");
    return await run();
  } catch (error) { return apiErrorResponse(error); }
}
// An admin or finance member can run the same collection now instead of waiting for the morning.
export async function POST(request: Request) {
  try { await financeActor(request); return await run(); }
  catch (error) { return apiErrorResponse(error); }
}
