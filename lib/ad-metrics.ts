import { measuredSum, safeRatio } from "./metric-format.ts";
export interface AdMeasurement { spend: number; attributed_revenue: number; conversions: number; impressions: number; clicks: number }
export function aggregateAdMetrics(rows: AdMeasurement[]) {
  const spend = measuredSum(rows.map(row => row.spend));
  const attributedRevenue = measuredSum(rows.map(row => row.attributed_revenue));
  const conversions = measuredSum(rows.map(row => row.conversions));
  const impressions = measuredSum(rows.map(row => row.impressions));
  const clicks = measuredSum(rows.map(row => row.clicks));
  return { spend, attributedRevenue, conversions, impressions, clicks, roas: safeRatio(attributedRevenue, spend), cpa: safeRatio(spend, conversions), ctr: safeRatio(clicks, impressions, 100), sampleCount: rows.length };
}
