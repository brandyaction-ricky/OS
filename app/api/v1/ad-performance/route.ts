import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { adConnectionStatus, syncAdPerformance, type AdBrand, type AdProvider } from "@/lib/server/ad-performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const syncSchema = z.object({
  provider: z.enum(["meta", "google", "all"]).default("all"),
  brands: z.array(z.enum(["myin", "brandyedu"])).min(1).max(2).optional(),
  from: z.string().date(),
  to: z.string().date(),
}).refine((value) => value.from <= value.to, { message: "시작일은 종료일보다 늦을 수 없습니다." });

function periodRange(period: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new ApiError(400, "INVALID_PERIOD", "기준월 형식을 확인해 주세요.");
  const [year, month] = period.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(lastDay).padStart(2, "0")}` };
}

function brandName(key: AdBrand) {
  return key === "myin" ? "마이인" : "브랜디액션 에듀";
}

function recordDate(record: { metadata?: Record<string, unknown>; starts_at?: string | null; due_date?: string | null; created_at: string }) {
  return String(record.metadata?.date ?? record.metadata?.paidAt ?? record.starts_at ?? record.due_date ?? record.created_at).slice(0, 10);
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const url = new URL(request.url);
    const period = url.searchParams.get("period") ?? new Date().toISOString().slice(0, 7);
    const brand = (url.searchParams.get("brand") ?? "all") as "all" | AdBrand;
    if (!(["all", "myin", "brandyedu"] as const).includes(brand)) throw new ApiError(400, "INVALID_BRAND", "브랜드 값을 확인해 주세요.");
    const range = periodRange(period);

    let metricsQuery = actor.supabase.from("os_ad_performance_daily").select("*")
      .gte("metric_date", range.from).lte("metric_date", range.to).order("metric_date", { ascending: true });
    if (brand !== "all") metricsQuery = metricsQuery.eq("brand_key", brand);
    const [{ data: rawRows, error }, { data: revenues }, { data: profile }] = await Promise.all([
      metricsQuery,
      actor.supabase.from("os_records").select("brand,amount,metadata,starts_at,due_date,created_at").eq("record_type", "revenue").is("archived_at", null),
      actor.supabase.from("os_profiles").select("finance_access").eq("id", actor.id).maybeSingle(),
    ]);
    if (error) throw new ApiError(400, "AD_PERFORMANCE_LIST_FAILED", "광고 성과를 불러오지 못했습니다.", error.message);

    const rows = (rawRows ?? []).map((row) => ({
      ...row,
      spend: Number(row.spend ?? 0),
      attributed_revenue: Number(row.attributed_revenue ?? 0),
      conversions: Number(row.conversions ?? 0),
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
    }));
    const selectedBrands = brand === "all" ? ["마이인", "브랜디액션 에듀"] : [brandName(brand)];
    const operatingRevenue = (revenues ?? []).filter((record) =>
      selectedBrands.includes(record.brand) && recordDate(record).startsWith(period),
    ).reduce((sum, record) => sum + Number(record.metadata?.net ?? record.amount ?? 0), 0);

    const financeVisible = actor.role === "admin" || Boolean(profile?.finance_access);
    let financeAdExpense: number | null = null;
    if (financeVisible) {
      const { data: expenses } = await actor.supabase.from("os_records")
        .select("brand,amount,tags,metadata,starts_at,due_date,created_at")
        .eq("record_type", "expense").is("archived_at", null);
      financeAdExpense = (expenses ?? []).filter((record) => {
        const marker = `${record.tags?.join(" ") ?? ""} ${String(record.metadata?.category ?? "")} ${String(record.metadata?.classification ?? "")}`;
        return selectedBrands.includes(record.brand) && recordDate(record).startsWith(period) && /광고|마케팅/i.test(marker);
      }).reduce((sum, record) => sum + Number(record.amount ?? 0), 0);
    }

    const aggregate = (source: typeof rows) => {
      const value = source.reduce((total, row) => ({
        spend: total.spend + row.spend,
        attributedRevenue: total.attributedRevenue + row.attributed_revenue,
        conversions: total.conversions + row.conversions,
        impressions: total.impressions + row.impressions,
        clicks: total.clicks + row.clicks,
      }), { spend: 0, attributedRevenue: 0, conversions: 0, impressions: 0, clicks: 0 });
      return {
        ...value,
        roas: value.spend ? value.attributedRevenue / value.spend : 0,
        cpa: value.conversions ? value.spend / value.conversions : 0,
        ctr: value.impressions ? value.clicks / value.impressions * 100 : 0,
      };
    };
    const channels = (["meta", "google"] as AdProvider[]).map((provider) => ({ provider, ...aggregate(rows.filter((row) => row.provider === provider)) }));

    let lastRuns: unknown[] = [];
    if (actor.role === "admin") {
      const { data } = await actor.supabase.from("os_ad_sync_runs").select("provider,brand_key,status,rows_written,error_message,started_at,finished_at")
        .order("started_at", { ascending: false }).limit(8);
      lastRuns = data ?? [];
    }
    return NextResponse.json({
      period, brand, range, connections: adConnectionStatus(), rows, channels,
      summary: { ...aggregate(rows), operatingRevenue, financeAdExpense },
      lastRuns,
    });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    if (actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 광고 데이터를 동기화할 수 있습니다.");
    const input = syncSchema.parse(await parseJson(request));
    const providers: AdProvider[] = input.provider === "all" ? ["meta", "google"] : [input.provider];
    const result = await syncAdPerformance({ providers, brands: input.brands, from: input.from, to: input.to });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_AD_SYNC", "동기화 범위를 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
