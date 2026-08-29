import { createServiceSupabase } from "@/lib/supabase/server";

export type AdProvider = "meta" | "google";
export type AdBrand = "myin" | "brandyedu";

export interface AdDailyMetric {
  provider: AdProvider;
  brand_key: AdBrand;
  metric_date: string;
  spend: number;
  attributed_revenue: number;
  conversions: number;
  impressions: number;
  clicks: number;
  currency: string;
  source_account: string;
}

const PROVIDERS: AdProvider[] = ["meta", "google"];
const BRANDS: AdBrand[] = ["myin", "brandyedu"];

function digits(value: string | undefined) {
  return (value ?? "").replace(/[^0-9]/g, "");
}

function accountSuffix(value: string) {
  return value ? `••••${value.slice(-4)}` : "";
}

function metaAccount(brand: AdBrand) {
  return digits(brand === "myin" ? process.env.META_ADS_MYIN_ACCOUNT_ID : process.env.META_ADS_BRANDYEDU_ACCOUNT_ID);
}

function googleAccount(brand: AdBrand) {
  return digits(brand === "myin" ? process.env.GOOGLE_ADS_MYIN_CUSTOMER_ID : process.env.GOOGLE_ADS_BRANDYEDU_CUSTOMER_ID);
}

export function adConnectionStatus() {
  const metaBase = Boolean(process.env.META_ADS_ACCESS_TOKEN);
  const googleBase = Boolean(
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
      process.env.GOOGLE_ADS_CLIENT_ID &&
      process.env.GOOGLE_ADS_CLIENT_SECRET &&
      process.env.GOOGLE_ADS_REFRESH_TOKEN,
  );
  return {
    meta: {
      configured: metaBase && BRANDS.some((brand) => Boolean(metaAccount(brand))),
      brands: Object.fromEntries(BRANDS.map((brand) => [brand, metaBase && Boolean(metaAccount(brand))])),
    },
    google: {
      configured: googleBase && BRANDS.some((brand) => Boolean(googleAccount(brand))),
      brands: Object.fromEntries(BRANDS.map((brand) => [brand, googleBase && Boolean(googleAccount(brand))])),
    },
  };
}

function actionValue(
  values: Array<{ action_type?: string; value?: string }> | undefined,
) {
  const priorities = ["omni_purchase", "offsite_conversion.fb_pixel_purchase", "purchase"];
  for (const actionType of priorities) {
    const item = values?.find((candidate) => candidate.action_type === actionType);
    if (item) return Number(item.value ?? 0) || 0;
  }
  return 0;
}

async function fetchMeta(brand: AdBrand, from: string, to: string): Promise<AdDailyMetric[]> {
  const account = metaAccount(brand);
  const token = process.env.META_ADS_ACCESS_TOKEN ?? "";
  if (!account || !token) return [];
  const version = process.env.META_ADS_API_VERSION ?? "v26.0";
  const params = new URLSearchParams({
    fields: "date_start,spend,actions,action_values,impressions,clicks,account_currency",
    time_range: JSON.stringify({ since: from, until: to }),
    time_increment: "1",
    level: "account",
    limit: "100",
  });
  const response = await fetch(`https://graph.facebook.com/${version}/act_${account}/insights?${params}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  const body = (await response.json().catch(() => ({}))) as {
    data?: Array<{
      date_start?: string; spend?: string; actions?: Array<{ action_type?: string; value?: string }>;
      action_values?: Array<{ action_type?: string; value?: string }>; impressions?: string; clicks?: string; account_currency?: string;
    }>;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(body.error?.message || `Meta API ${response.status}`);
  return (body.data ?? []).map((row) => ({
    provider: "meta",
    brand_key: brand,
    metric_date: row.date_start ?? from,
    spend: Number(row.spend ?? 0) || 0,
    attributed_revenue: actionValue(row.action_values),
    conversions: actionValue(row.actions),
    impressions: Number(row.impressions ?? 0) || 0,
    clicks: Number(row.clicks ?? 0) || 0,
    currency: row.account_currency || "KRW",
    source_account: accountSuffix(account),
  }));
}

async function googleAccessToken() {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET ?? "",
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN ?? "",
      grant_type: "refresh_token",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!response.ok || !body.access_token) throw new Error(body.error_description || `Google OAuth ${response.status}`);
  return body.access_token;
}

async function fetchGoogle(brand: AdBrand, from: string, to: string): Promise<AdDailyMetric[]> {
  const customer = googleAccount(brand);
  if (!customer || !adConnectionStatus().google.brands[brand]) return [];
  const accessToken = await googleAccessToken();
  const version = process.env.GOOGLE_ADS_API_VERSION ?? "v25";
  const query = `SELECT customer.currency_code, segments.date, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.impressions, metrics.clicks FROM customer WHERE segments.date BETWEEN '${from}' AND '${to}' ORDER BY segments.date`;
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
    "content-type": "application/json",
  };
  const loginCustomer = digits(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  if (loginCustomer) headers["login-customer-id"] = loginCustomer;
  const response = await fetch(`https://googleads.googleapis.com/${version}/customers/${customer}/googleAds:searchStream`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  const body = (await response.json().catch(() => ({}))) as Array<{
    results?: Array<{
      segments?: { date?: string };
      customer?: { currencyCode?: string };
      metrics?: { costMicros?: string; conversions?: number; conversionsValue?: number; impressions?: string; clicks?: string };
    }>;
  }> | { error?: { message?: string } };
  if (!response.ok || !Array.isArray(body)) {
    const failure = !Array.isArray(body) ? body.error?.message : "";
    throw new Error(failure || `Google Ads API ${response.status}`);
  }
  return body.flatMap((chunk) => chunk.results ?? []).map((row) => ({
    provider: "google" as const,
    brand_key: brand,
    metric_date: row.segments?.date ?? from,
    spend: Number(row.metrics?.costMicros ?? 0) / 1_000_000,
    attributed_revenue: Number(row.metrics?.conversionsValue ?? 0) || 0,
    conversions: Number(row.metrics?.conversions ?? 0) || 0,
    impressions: Number(row.metrics?.impressions ?? 0) || 0,
    clicks: Number(row.metrics?.clicks ?? 0) || 0,
    currency: row.customer?.currencyCode || "KRW",
    source_account: accountSuffix(customer),
  }));
}

function safeMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : "알 수 없는 광고 API 오류";
  const secrets = [
    process.env.META_ADS_ACCESS_TOKEN,
    process.env.GOOGLE_ADS_CLIENT_SECRET,
    process.env.GOOGLE_ADS_REFRESH_TOKEN,
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
  ].filter(Boolean) as string[];
  return secrets.reduce((message, secret) => message.replaceAll(secret, "[redacted]"), raw).slice(0, 500);
}

export async function syncAdPerformance(input: {
  providers?: AdProvider[];
  brands?: AdBrand[];
  from: string;
  to: string;
}) {
  const providers = input.providers?.length ? input.providers : PROVIDERS;
  const brands = input.brands?.length ? input.brands : BRANDS;
  const service = createServiceSupabase();
  const connections = adConnectionStatus();
  const results = await Promise.all(providers.flatMap((provider) => brands.map(async (brand) => {
      const configured = connections[provider].brands[brand];
      const { data: run } = await service.from("os_ad_sync_runs").insert({
        provider, brand_key: brand, status: configured ? "running" : "skipped", range_start: input.from, range_end: input.to,
        finished_at: configured ? null : new Date().toISOString(), error_message: configured ? "" : "credentials_not_configured",
      }).select("id").single();
      if (!configured) {
        return { provider, brand, status: "skipped", rows: 0 };
      }
      try {
        const rows = provider === "meta" ? await fetchMeta(brand, input.from, input.to) : await fetchGoogle(brand, input.from, input.to);
        if (rows.length) {
          const { error } = await service.from("os_ad_performance_daily").upsert(
            rows.map((row) => ({ ...row, fetched_at: new Date().toISOString(), updated_at: new Date().toISOString() })),
            { onConflict: "provider,brand_key,metric_date" },
          );
          if (error) throw new Error(error.message);
        }
        if (run?.id) await service.from("os_ad_sync_runs").update({ status: "done", rows_written: rows.length, finished_at: new Date().toISOString() }).eq("id", run.id);
        return { provider, brand, status: "done", rows: rows.length };
      } catch (error) {
        const message = safeMessage(error);
        if (run?.id) await service.from("os_ad_sync_runs").update({ status: "failed", error_message: message, finished_at: new Date().toISOString() }).eq("id", run.id);
        return { provider, brand, status: "failed", rows: 0, error: message };
      }
  })));
  return { from: input.from, to: input.to, results };
}

export function trailingDateRange(days = 7) {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - Math.max(1, days - 1));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}
