import { z } from "zod";

const id = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/);
const selection = z.string().trim().min(1).max(500).regex(/^[A-Za-z0-9_+ -]+$/);
const table = { orgId: id, tblId: id };
export const kosisInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("search"), query: z.string().trim().min(2).max(120), page: z.number().int().min(1).max(100).default(1), limit: z.number().int().min(1).max(20).default(10), sort: z.enum(["RANK", "DATE"]).default("RANK") }).strict(),
  z.object({ action: z.literal("metadata"), ...table, type: z.enum(["TBL", "ORG", "PRD", "ITM", "UNIT", "SOURCE"]).default("ITM") }).strict(),
  z.object({ action: z.literal("data"), ...table, itmId: selection, objL1: selection, objL2: selection.optional(), objL3: selection.optional(), objL4: selection.optional(), objL5: selection.optional(), objL6: selection.optional(), objL7: selection.optional(), objL8: selection.optional(), prdSe: z.enum(["Y", "M", "Q", "S", "D", "F", "IR"]), newEstPrdCnt: z.number().int().min(1).max(12).default(1) }).strict(),
]);
export type KosisInput = z.infer<typeof kosisInputSchema>;
export class KosisError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
export function kosisTableUrl(orgId: string, tblId: string) {
  return `https://kosis.kr/statHtml/statHtml.do?${new URLSearchParams({ orgId, tblId })}`;
}
export function kosisRequest(input: KosisInput) {
  const params = new URLSearchParams({ format: "json", jsonVD: "Y" });
  let path = "statisticsData.do";
  if (input.action === "search") {
    path = "statisticsSearch.do";
    Object.entries({ method: "getList", searchNm: input.query, startCount: input.page, resultCount: input.limit, sort: input.sort }).forEach(([key, value]) => params.set(key, String(value)));
  } else if (input.action === "metadata") {
    Object.entries({ method: "getMeta", type: input.type, orgId: input.orgId, tblId: input.tblId }).forEach(([key, value]) => params.set(key, value));
  } else {
    path = "Param/statisticsParameterData.do";
    params.set("method", "getList"); params.set("smblChk", "Y");
    Object.entries(input).forEach(([key, value]) => { if (key !== "action" && value !== undefined) params.set(key, String(value)); });
  }
  return { path, params };
}

const stringValue = (row: Record<string, unknown>, key: string) => typeof row[key] === "string" || typeof row[key] === "number" ? String(row[key]) : "";
const rowSchema = z.record(z.union([z.string(), z.number(), z.null()]));
export function normalizeKosis(input: KosisInput, payload: unknown) {
  // KOSIS can return an API error even with HTTP 200, including inside an array.
  const rows = Array.isArray(payload) ? payload : [payload];
  if (rows.some(row => row && typeof row === "object" && ("err" in row || "errMsg" in row))) {
    throw new KosisError(502, "KOSIS_API_ERROR", "KOSIS 조회가 거절됐습니다. 인증키·조회 조건·호출 한도를 확인해 주세요.");
  }
  if (!Array.isArray(payload)) throw new KosisError(502, "KOSIS_INVALID_RESPONSE", "KOSIS 응답 형식을 확인할 수 없습니다.");
  if (rows.length > 1000) throw new KosisError(422, "KOSIS_RESULT_TOO_LARGE", "결과가 너무 많습니다. 항목·분류·기간을 좁혀 주세요.");
  const parsed = z.array(rowSchema).safeParse(rows);
  if (!parsed.success) throw new KosisError(502, "KOSIS_INVALID_RESPONSE", "KOSIS 응답 형식을 확인할 수 없습니다.");
  if (input.action === "metadata") return { action: input.action, sourceUrl: kosisTableUrl(input.orgId, input.tblId), type: input.type, items: parsed.data };
  if (input.action === "search") {
    if (parsed.data.some(row => !stringValue(row, "ORG_ID") || !stringValue(row, "TBL_ID"))) throw new KosisError(502, "KOSIS_INVALID_RESPONSE", "검색 결과의 통계표를 확인할 수 없습니다.");
    return { action: input.action, query: input.query, page: input.page, limit: input.limit, total: parsed.data.length ? stringValue(parsed.data[0], "STAT_DB_CNT") || null : null, items: parsed.data.map(row => ({ orgId: stringValue(row, "ORG_ID"), organization: stringValue(row, "ORG_NM"), tblId: stringValue(row, "TBL_ID"), title: stringValue(row, "TBL_NM"), periodFrom: stringValue(row, "STRT_PRD_DE"), periodTo: stringValue(row, "END_PRD_DE"), notes: stringValue(row, "ITEM03"), sourceUrl: kosisTableUrl(stringValue(row, "ORG_ID"), stringValue(row, "TBL_ID")) })) };
  }
  if (parsed.data.some(row => stringValue(row, "ORG_ID") !== input.orgId || stringValue(row, "TBL_ID") !== input.tblId || !stringValue(row, "PRD_DE") || !stringValue(row, "ITM_ID") || stringValue(row, "PRD_SE") !== input.prdSe || !Object.hasOwn(row, "DT"))) throw new KosisError(502, "KOSIS_INVALID_RESPONSE", "요청한 통계표·시점과 응답이 일치하지 않습니다.");
  return { action: input.action, sourceUrl: kosisTableUrl(input.orgId, input.tblId), selection: input, items: parsed.data.map(row => ({ title: stringValue(row, "TBL_NM"), itemId: stringValue(row, "ITM_ID"), item: stringValue(row, "ITM_NM"), unit: stringValue(row, "UNIT_NM") || null, period: stringValue(row, "PRD_DE"), frequency: stringValue(row, "PRD_SE"), value: row.DT === null ? null : stringValue(row, "DT"), updatedAt: stringValue(row, "LST_CHN_DE") || null, dimensions: Array.from({ length: 8 }, (_, i) => i + 1).filter(i => stringValue(row, `C${i}`)).map(i => ({ id: stringValue(row, `C${i}`), category: stringValue(row, `C${i}_OBJ_NM`), label: stringValue(row, `C${i}_NM`) })) })) };
}

// Per-instance bounds; provider quotas still apply across all deployed instances.
const cache = new Map<string, { expires: number; value: unknown }>();
let windowStart = 0;
let calls = 0;
export async function queryKosis(input: KosisInput, apiKey: string | undefined, fetcher: typeof fetch = fetch) {
  if (!apiKey?.trim()) throw new KosisError(503, "KOSIS_NOT_CONFIGURED", "KOSIS 인증키가 아직 연결되지 않았습니다.");
  const { path, params } = kosisRequest(input);
  const cacheKey = JSON.stringify(input);
  const cached = cache.get(cacheKey);
  const now = Date.now();
  if (fetcher === fetch && cached && cached.expires > now) return cached.value;
  if (now - windowStart >= 60_000) { windowStart = now; calls = 0; }
  if (calls >= 20) throw new KosisError(429, "KOSIS_RATE_LIMITED", "통계 조회가 많습니다. 잠시 후 다시 시도해 주세요.");
  calls++;
  params.set("apiKey", apiKey);
  let payload: unknown;
  try {
    const response = await fetcher(`https://kosis.kr/openapi/${path}?${params}`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new KosisError(response.status === 429 ? 429 : 502, "KOSIS_UNAVAILABLE", "KOSIS에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    const reader = response.body?.getReader();
    if (!reader) throw new KosisError(502, "KOSIS_INVALID_RESPONSE", "KOSIS 응답을 읽지 못했습니다.");
    const chunks: Uint8Array[] = []; let bytes = 0;
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 1_000_000) { await reader.cancel(); throw new KosisError(422, "KOSIS_RESULT_TOO_LARGE", "결과가 너무 많습니다. 조회 조건을 좁혀 주세요."); }
      chunks.push(chunk.value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    // Never propagate a provider response that reflects the credential.
    if (text.includes(apiKey)) throw new KosisError(502, "KOSIS_INVALID_RESPONSE", "KOSIS 응답을 안전하게 처리할 수 없습니다.");
    payload = JSON.parse(text);
  } catch (error) {
    if (error instanceof KosisError) throw error;
    // Network exceptions can contain the complete credential-bearing URL.
    throw new KosisError(502, "KOSIS_UNAVAILABLE", "KOSIS 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  const result = { provider: "KOSIS", retrievedAt: new Date().toISOString(), ...normalizeKosis(input, payload), notice: "원문 단위·대상·시점을 확인하세요. 결측·통계부호는 원문 그대로이며, 검색 결과는 수치 검증이 아닙니다. 국제·북한통계는 이용조건을 별도 확인하세요." };
  if (fetcher === fetch) {
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(cacheKey, { expires: now + 600_000, value: result });
  }
  return result;
}
