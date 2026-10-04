export const CHANNEL_METRICS={instagram:["views","reach","likes","comments","saved","shares","total_interactions"],threads:["views","likes","replies","reposts","quotes","shares"]} as const;
export const METRIC_LABELS:Record<string,string>={views:"조회",reach:"도달",likes:"좋아요",comments:"댓글",saved:"저장",shares:"공유",total_interactions:"총 반응",replies:"답글",reposts:"리포스트",quotes:"인용"};
export type Snapshot="d1"|"d7"|"d28";
type MetricRecord = { id: string; status: string; title: string; metadata: Record<string, unknown> };
export function measuredValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
// A publication is one sample per snapshot. Never interpret missing values as zero.
export function metricSamples<T extends MetricRecord>(records: T[], metric: string, from = "", to = ""): T[] {
  const unique = new Map<string, T>();
  for (const row of records) {
    const m = row.metadata;
    const published = typeof m.publishedAt === "string" ? m.publishedAt.slice(0, 10) : "";
    if (row.status === "archived" || m.source !== "api" || m.metric !== metric || measuredValue(m.value) === null ||
        !["d1", "d7", "d28"].includes(String(m.snapshot)) || !["instagram", "threads", "yt_long", "yt_shorts"].includes(String(m.platform)) ||
        typeof m.publishId !== "string" || !m.publishId || !published || !Number.isFinite(Date.parse(String(m.publishedAt))) ||
        (from && published < from) || (to && published > to)) continue;
    const key = `${m.platform}:${m.publishId}:${m.snapshot}`;
    const previous = unique.get(key);
    if (!previous || String(m.measuredAt ?? "") > String(previous.metadata.measuredAt ?? "")) unique.set(key, row);
  }
  return [...unique.values()];
}
export function dueMetricSnapshot(publishedAt:string,now=new Date()):Snapshot|null{
  const age=(now.getTime()-Date.parse(publishedAt))/86400000;if(!Number.isFinite(age))return null;
  // Never relabel today's lifetime count as a missed historical measurement.
  for(const day of [1,7,28] as const)if(age>=day&&age<day+1)return `d${day}`;
  return null;
}
export function parseChannelMetrics(platform:keyof typeof CHANNEL_METRICS,items:Record<string,unknown>[]){
  const result:Record<string,number>={};
  for(const item of items){
    const key=String(item.name);if(!(CHANNEL_METRICS[platform] as readonly string[]).includes(key))continue;
    const raw=(item.total_value as {value?:unknown}|undefined)?.value??(Array.isArray(item.values)?(item.values[0] as {value?:unknown}|undefined)?.value:undefined);
    if(typeof raw!=="number"||!Number.isFinite(raw)||raw<0)continue;
    result[key]=raw;
  }
  return result;
}
export function sampleSummary(values:number[]){
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b),n=sorted.length;
  return {n,median:n?(sorted[Math.floor((n-1)/2)]+sorted[Math.floor(n/2)])/2:null,min:n?sorted[0]:null,max:n?sorted[n-1]:null};
}
export function compareMetricSamples(a:number[],b:number[]){
  const left=sampleSummary(a),right=sampleSummary(b);
  if(left.n<5||right.n<5)return "비교 보류 · 각 표본 5개 이상 필요";
  if(left.min!<=right.max!&&right.min!<=left.max!)return "차이 없음 · 관찰 범위 겹침";
  return "관찰 범위 분리 · 인과·유의성 판정 아님";
}
