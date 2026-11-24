"use client";

import { useState } from "react";
import {
  adDisposition,
  evaluateAd,
  measurementIssue,
  type AdAspect,
  type AdDisposition,
  type AdMeasurement,
  type AdRelease,
} from "@/lib/ad-production";
import { campaignTrackingUrl } from "@/lib/ad-campaign";

type Props = {
  path?: "free" | "paid";
  medium: "video" | "image";
  landing: string;
  campaign: string;
  aspects: AdAspect[];
  headline: string;
  body: string;
  cta: string;
  release?: AdRelease;
  measurement?: AdMeasurement;
  isTest: boolean;
  save: (decision: AdDisposition) => Promise<void>;
  measure: (row: AdMeasurement) => Promise<void>;
};

export function AdDelivery({
  path = "free",
  medium,
  landing,
  campaign,
  aspects,
  headline,
  body,
  cta,
  release,
  measurement,
  isTest,
  save,
  measure,
}: Props) {
  const [kind, setKind] = useState<AdDisposition["kind"]>("published"),
    [entry, setEntry] = useState("");
  const [uploaded, setUploaded] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const decision = adDisposition({ kind, value: entry });
  const lines = [
    body.trim().slice(0, 125),
    headline.trim().slice(0, 40),
    cta,
    ...aspects.map((a) => {
      const url = campaignTrackingUrl(landing, campaign, medium, a);
      return url ? a.replace("x", ":") + " · " + url : "";
    }),
  ]
    .filter(Boolean)
    .join("\n");
  async function submit() {
    if (!decision || busy || (kind === "published" && !uploaded)) return;
    setBusy(true);
    setMessage("");
    try {
      await save(decision);
      setMessage("집행 기록을 저장했어요.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "저장하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel panel-pad-lg ad-delivery">
      <h2>집행 패키지</h2>
      <label>
        본문 · 헤드라인 · 행동 문구 · 크기별 추적 주소
        <textarea className="field" rows={5} readOnly value={lines} onFocus={(e) => e.currentTarget.select()} />
      </label>
      <button
        type="button"
        className="secondary-button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(lines);
            setMessage("집행 패키지를 복사했어요.");
          } catch {
            setMessage("위 칸에서 직접 복사해 주세요.");
          }
        }}
      >
        패키지 복사
      </button>
      {release ? (
        <p>
          <strong>{release.kind === "published" ? "집행 광고 ID" : "집행 안 함"}</strong> · {release.value}
        </p>
      ) : (
        <fieldset disabled={busy}>
          <legend>집행 기록</legend>
          <div className="ic-row">
            {(["published", "withheld"] as const).map((k) => (
              <label key={k}>
                <input
                  type="radio"
                  name="ad-disposition"
                  checked={kind === k}
                  onChange={() => {
                    setKind(k);
                    setEntry("");
                  }}
                />{" "}
                {k === "published" ? "광고 관리자에 올림" : "집행 안 함"}
              </label>
            ))}
          </div>
          {kind === "published" && (
            <label>
              <input type="checkbox" checked={uploaded} onChange={(e) => setUploaded(e.target.checked)} /> 광고
              관리자에 직접 올렸어요
            </label>
          )}
          <label>
            {kind === "published" ? "광고 ID 또는 Meta 광고 라이브러리 주소" : "집행하지 않은 이유"}
            <input
              className="field"
              value={entry}
              maxLength={kind === "published" ? 2000 : 300}
              onChange={(e) => setEntry(e.target.value)}
              placeholder={kind === "published" ? "12~20자리 광고 ID" : "4자 이상 입력"}
            />
          </label>
          <button
            type="button"
            className="primary-button"
            disabled={!decision || (kind === "published" && !uploaded)}
            onClick={() => void submit()}
          >
            집행 기록 저장
          </button>
        </fieldset>
      )}
      {message && <p role="status">{message}</p>}
      {release?.kind === "published" && (
        <AdPerformance path={path} key={release.at} initial={measurement} isTest={isTest} save={measure} />
      )}
    </section>
  );
}

const fields = {
  impressions: "노출",
  clicks: "링크 클릭",
  spend: "광고 지출 (원)",
  otherCosts: "추가 획득 비용 (원)",
  starts: "진단 시작 (선행)",
  completions: "진단 완료 (선행)",
  purchases: "유료 구매",
  refundedOrders: "환불 주문",
  revenue: "매출 (원)",
  refunds: "환불액 (원)",
} as const;
function AdPerformance({
  initial,
  isTest,
  save,
  path,
}: {
  path: "free" | "paid";
  initial?: AdMeasurement;
  isTest: boolean;
  save: (row: AdMeasurement) => Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [row, setRow] = useState<AdMeasurement>(
    initial ?? {
      from: today,
      to: today,
      impressions: 0,
      clicks: 0,
      spend: 0,
      otherCosts: 0,
      starts: 0,
      completions: 0,
      purchases: 0,
      refundedOrders: 0,
      revenue: 0,
      refunds: 0,
      cohortConfirmed: false,
    },
  );
  const [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const result = evaluateAd(row, isTest);
  function change(patch: Partial<AdMeasurement>) {
    setRow((r) => ({ ...r, ...patch }));
    setStatus("");
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || measurementIssue(row)) return;
        setBusy(true);
        try {
          await save(row);
          setStatus("성과를 저장했어요.");
        } catch (err) {
          setStatus(err instanceof Error ? err.message : "저장하지 못했어요.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>집행 성과</h3>
      {isTest && <p>시험 광고의 기록은 성과 비교와 다음 광고의 AI 입력에서 제외됩니다.</p>}
      <div className="ad-measures">
        {(["from", "to"] as const).map((k) => (
          <label key={k}>
            {k === "from" ? "집계 시작일" : "집계 종료일"}
            <input
              className="field"
              type="date"
              value={row[k]}
              max={today}
              onChange={(e) => change({ [k]: e.target.value })}
            />
          </label>
        ))}
        {(Object.keys(fields) as (keyof typeof fields)[])
          .filter((k) => path === "free" || !["starts", "completions"].includes(k))
          .map((k) => (
            <label key={k}>
              {fields[k]}
              <input
                type="number"
                required
                className="field"
                min={0}
                step={1}
                value={row[k]}
                onChange={(e) => change({ [k]: Number(e.target.value) })}
              />
            </label>
          ))}
      </div>
      <label>
        <input
          type="checkbox"
          checked={row.cohortConfirmed}
          onChange={(e) => change({ cohortConfirmed: e.target.checked })}
        />{" "}
        같은 UTM으로 유입된 고객의 7일 유료 구매를 확인했어요
      </label>
      <p role="status">
        {result.hold
          ? "판단 보류 · " + result.hold
          : "유료 구매당 총 획득비 " +
            Math.round(result.cpa!).toLocaleString("ko-KR") +
            "원 · 환불 반영 ROAS " +
            (result.roas?.toFixed(2) ?? "—")}
      </p>
      <button className="secondary-button" disabled={busy || !!measurementIssue(row)}>
        성과 저장
      </button>{" "}
      {status && <span role="status">{status}</span>}
    </form>
  );
}
