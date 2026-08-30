import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const date = z.string().date();
const nonNegative = z.number().finite().nonnegative();
const nonNegativeInteger = z.number().int().nonnegative();
const revenueRow = z.object({
  date,
  brand: z.enum(["마이인", "브랜디액션 에듀"]),
  gross: nonNegative,
  cancel: nonNegative,
  refund: nonNegative,
  orders: nonNegativeInteger,
  buyers: nonNegativeInteger,
  source: z.string().trim().min(1).max(120),
});
const adRow = z.object({
  provider: z.enum(["meta", "google"]),
  brand: z.enum(["myin", "brandyedu"]),
  date,
  spend: nonNegative,
  attributedRevenue: nonNegative,
  conversions: nonNegative,
  impressions: nonNegativeInteger,
  clicks: nonNegativeInteger,
});
const importSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("revenue"), rows: z.array(revenueRow).min(1).max(2_000) }),
  z.object({ kind: z.literal("ads"), rows: z.array(adRow).min(1).max(2_000) }),
]);

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = importSchema.parse(await parseJson(request));
    if (input.kind === "revenue") {
      const payload = input.rows.map((row) => {
        const net = row.gross - row.cancel - row.refund;
        if (net < 0) throw new ApiError(400, "INVALID_REVENUE_ROW", `${row.date} 순매출이 0보다 작습니다.`);
        return {
          record_type: "revenue",
          title: `${row.brand} ${row.date} 매출`,
          description: "브랜드 매출 상세",
          status: "done",
          brand: row.brand,
          amount: net,
          metric_unit: "원",
          metadata: { ...row, net },
          owner_id: actor.id,
          created_by: actor.id,
          updated_by: actor.id,
          team: actor.team,
        };
      });
      const { error } = await actor.supabase.from("os_records").insert(payload);
      if (error) throw new ApiError(400, "REVENUE_IMPORT_FAILED", "매출 CSV를 저장하지 못했습니다.", error.message);
      return NextResponse.json({ ok: true, imported: payload.length });
    }

    if (actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 광고 CSV를 가져올 수 있습니다.");
    const service = createServiceSupabase();
    const now = new Date().toISOString();
    const payload = input.rows.map((row) => ({
      provider: row.provider,
      brand_key: row.brand,
      metric_date: row.date,
      spend: row.spend,
      attributed_revenue: row.attributedRevenue,
      conversions: row.conversions,
      impressions: row.impressions,
      clicks: row.clicks,
      currency: "KRW",
      source_account: "CSV upload",
      fetched_at: now,
      updated_at: now,
    }));
    const { error } = await service.from("os_ad_performance_daily").upsert(payload, { onConflict: "provider,brand_key,metric_date" });
    if (error) throw new ApiError(400, "AD_IMPORT_FAILED", "광고 CSV를 저장하지 못했습니다.", error.message);
    return NextResponse.json({ ok: true, imported: payload.length });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_PERFORMANCE_CSV", "CSV 입력 내용을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
