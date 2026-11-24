/** Manual Meta handoff. An OS approval or a downloaded file alone does not prove delivery. */
export type AdDisposition = { kind: "published" | "withheld"; value: string };
export interface AdRelease extends AdDisposition {
  at: string;
}
export const AD_VIDEO_STEPS = ["상품", "주제", "대본", "제작", "최종 검토", "내보내기"];
export const AD_IMAGE_STEPS = ["상품", "구매 이유", "디자인 견본", "카피 · 디자인", "최종 검토", "내보내기"];

export function adDisposition(input?: AdDisposition): AdDisposition | undefined {
  if (!input) return;
  const value = input.value.trim();
  if (input.kind === "withheld")
    return value.length >= 4 && value.length <= 300 ? { kind: input.kind, value } : undefined;
  if (input.kind !== "published") return;
  let id = value;
  if (!/^\d{12,20}$/.test(id)) {
    try {
      const url = new URL(value);
      if (
        url.protocol !== "https:" ||
        !["www.facebook.com", "facebook.com"].includes(url.host) ||
        !/^\/ads\/library\/?$/.test(url.pathname) ||
        url.username ||
        url.password ||
        url.searchParams.getAll("id").length !== 1
      )
        return;
      id = url.searchParams.get("id") ?? "";
    } catch {
      return;
    }
  }
  if (/^\d{12,20}$/.test(id)) return { kind: "published", value: id };
}

export const AD_COPY_RULES = [
  "숫자와 인용 후기는 확인한 근거에서 가져와요.",
  "결핍이 사라진다는 표현을 피하세요.",
  "결과 보장이나 수량·마감 압박을 피하세요.",
  "고객에게 제안하는 행동은 하나로 정해요.",
  "고객용 표현을 쓰고 강점 30가지와 욕구 6가지를 구분해요.",
  "가격과 제공 시점은 확인된 값만 써요.",
];
/** Match claims with units to avoid borrowing a price or a duration for an unrelated claim. */
export function adCopyIssues(copy: string, evidence: string) {
  const compact = (value: string) => value.normalize("NFKC").replace(/[\s,]/g, "");
  const units = /\d[\d,]*(?:\.\d+)?\s*(?:만\s*원|천\s*원|시간|가지|개월|원|일|초|분|위|배|명|개|%|회|건)?/g;
  const claims = (value: string) => (value.replace(/^\s*\d+[.)]\s+/gm, "").match(units) ?? []).map(compact);
  const known = new Set(claims(evidence));
  const unsupported = claims(copy).filter((item) => !known.has(item));
  const quotes = Array.from(
    copy.matchAll(/(?:후기|고객의?\s*(?:말|평))\s*[:：]?\s*["“]([^"”]+)["”]/g),
    (m) => m[1],
  );
  const issues: string[] = [];
  if (unsupported.length || quotes.some((q) => !compact(evidence).includes(compact(q))))
    issues.push(AD_COPY_RULES[0]);
  if (/채워(?:진|져)|사라(?:진|져)|해결(?:된|돼)|비로소\s*만족|비교가?\s*없어/.test(copy))
    issues.push(AD_COPY_RULES[1]);
  if (/무조건|(?:수익|소득|결과|성공)\s*보장|마감\s*임박|선착순|단\s*\d+\s*일|몇\s*초\s*테스트/.test(copy))
    issues.push(AD_COPY_RULES[2]);
  if (
    /(무료.{0,14}(?:시작|받기|신청|하기))/.test(copy) &&
    /(?:정밀|유료).{0,14}(?:구매|신청|받기|하기)/.test(copy)
  )
    issues.push(AD_COPY_RULES[3]);
  if (
    /(?:^|[^가-힣])결(?:[을은이가의로에]|$|[^가-힣])|강점\s*6가지|6가지\s*강점|욕구\s*30가지|30가지\s*욕구/.test(
      copy,
    )
  )
    issues.push(AD_COPY_RULES[4]);
  const promises =
    copy.match(
      /무료|당일\s*(?:제공|발송|배송)|즉시\s*(?:제공|발송|배송)|\d[\d,]*\s*(?:만\s*)?원|\d+\s*(?:일|시간)\s*(?:이내|내에)/g,
    ) ?? [];
  if (promises.some((value) => !compact(evidence).includes(compact(value)))) issues.push(AD_COPY_RULES[5]);
  return issues;
}

export type AdAspect = "9x16" | "4x5" | "1x1";
export type AdSetup = {
  brand?: string;
  audience?: string;
  offer?: string;
  product: string;
  evidence: string;
  goal: string;
  landingUrl: string;
  campaign: string;
  aspects: AdAspect[];
  path: "free" | "paid";
};
export interface AdMeasurement {
  from: string;
  to: string;
  impressions: number;
  clicks: number;
  spend: number;
  purchases: number;
  revenue: number;
  refunds: number;
  refundedOrders: number;
  otherCosts: number;
  starts: number;
  completions: number;
  cohortConfirmed: boolean;
}
export function measurementIssue(row: AdMeasurement) {
  const day = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;
  if (!day(row.from) || !day(row.to) || row.from > row.to || Date.parse(row.to) > Date.now())
    return "집행 기간을 확인해 주세요.";
  if (Object.values(row).some((v) => typeof v === "number" && (!Number.isSafeInteger(v) || v < 0 || v > 1e12)))
    return "집계값은 0 이상의 정수로 입력해 주세요.";
  if (row.refundedOrders > row.purchases || row.refunds > row.revenue || row.completions > row.starts)
    return "구매·환불 및 진단 시작·완료 수를 확인해 주세요.";
  return "";
}
export function evaluateAd(row: AdMeasurement, isTest: boolean) {
  const orders = row.purchases - row.refundedOrders;
  const hold =
    measurementIssue(row) ||
    (isTest
      ? "시험 광고"
      : !row.cohortConfirmed
        ? "같은 UTM의 구매 집계 확인 필요"
        : row.impressions < 1000
          ? "노출 1,000회 미만"
          : row.clicks < 30
            ? "링크 클릭 30회 미만"
            : Date.parse(row.to) - Date.parse(row.from) < 6 * 86400000
              ? "집행 7일 미만"
              : orders <= 0
                ? "환불 반영 유료 구매 없음"
                : "");
  return {
    hold,
    cpa: orders > 0 ? (row.spend + row.otherCosts) / orders : null,
    roas: row.spend > 0 ? (row.revenue - row.refunds) / row.spend : null,
  };
}
