"use client";

import { BarChart3, CircleAlert, CircleDollarSign, ExternalLink, RefreshCw, Target, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getAdPerformance, syncAdPerformance, type AdPerformanceResponse } from "@/lib/api-client";
import { useSession } from "./session-provider";

const BRANDS = [
  { key: "all", label: "통합" },
  { key: "myin", label: "마이인" },
  { key: "brandyedu", label: "브랜디액션 에듀" },
] as const;

const money = (value: number) => `${Math.round(value).toLocaleString("ko-KR")}원`;
const ratio = (value: number) => `${value.toFixed(2)}배`;
const currentMonth = () => new Date().toISOString().slice(0, 7);

export function AdPerformanceWorkspace() {
  const { accessToken, demo, profile } = useSession();
  const [brand, setBrand] = useState<(typeof BRANDS)[number]["key"]>("all");
  const [period, setPeriod] = useState(currentMonth());
  const [data, setData] = useState<AdPerformanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (demo) return;
    setLoading(true);
    try {
      setData(await getAdPerformance(accessToken, { period, brand }));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "광고 성과를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, brand, demo, period]);

  useEffect(() => { load(); }, [load]);

  const runSync = async () => {
    if (!data) return;
    setSyncing(true);
    try {
      await syncAdPerformance(accessToken, {
        provider: "all",
        brands: brand === "all" ? undefined : [brand],
        from: data.range.from,
        to: data.range.to,
      });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "광고 데이터를 동기화하지 못했습니다.");
    } finally {
      setSyncing(false);
    }
  };

  const connectedCount = Number(data?.connections.meta.configured) + Number(data?.connections.google.configured);
  const summary = data?.summary;
  const daily = useMemo(() => {
    const dates = new Map<string, { spend: number; revenue: number }>();
    for (const row of data?.rows ?? []) {
      const current = dates.get(row.metric_date) ?? { spend: 0, revenue: 0 };
      current.spend += row.spend;
      current.revenue += row.attributed_revenue;
      dates.set(row.metric_date, current);
    }
    return [...dates.entries()].sort(([left], [right]) => right.localeCompare(left)).slice(0, 14);
  }, [data]);

  return (
    <>
      <header className="page-header">
        <div className="page-title-group">
          <span className="eyebrow">AD PERFORMANCE</span>
          <h1>광고 성과</h1>
          <p>Meta·Google 광고 데이터를 읽기 전용으로 모아 광고비, 전환 매출, ROAS와 CPA를 비교합니다.</p>
        </div>
        <div className="ad-toolbar">
          <input aria-label="기준월" type="month" value={period} onChange={(event) => setPeriod(event.target.value)} />
          <button className="secondary-button" disabled={loading} onClick={load}><RefreshCw size={15} className={loading ? "spin" : ""} /> 새로고침</button>
          {profile?.role === "admin" ? <button className="primary-button" disabled={syncing || connectedCount === 0} onClick={runSync}><RefreshCw size={15} className={syncing ? "spin" : ""} /> API 동기화</button> : null}
        </div>
      </header>
      {error ? <div className="inline-alert danger"><CircleAlert size={16} />{error}</div> : null}
      <div className="brand-switch">{BRANDS.map((item) => <button key={item.key} className={brand === item.key ? "active" : ""} onClick={() => setBrand(item.key)}>{item.label}</button>)}</div>

      <section className="ad-connection-strip">
        {(["meta", "google"] as const).map((provider) => {
          const connection = data?.connections[provider];
          const title = provider === "meta" ? "Meta Ads" : "Google Ads";
          return <article className="panel ad-connection" key={provider}>
            <span className={connection?.configured ? "connected" : "waiting"}><BarChart3 size={17} /></span>
            <div><strong>{title}</strong><small>{connection?.configured ? "읽기 전용 API 연결됨" : "광고 계정 환경변수 등록 대기"}</small></div>
            <em className={connection?.configured ? "connected" : "waiting"}>{connection?.configured ? "연결" : "대기"}</em>
          </article>;
        })}
        <article className="panel ad-principle"><Target size={17} /><div><strong>운영은 광고 플랫폼에서</strong><small>소재·타깃·입찰 변경 없이 성과만 집계합니다.</small></div></article>
      </section>

      <section className="metric-grid compact-metrics">
        <article className="metric-card"><div className="metric-top"><span>광고비</span><CircleDollarSign size={16} /></div><div className="metric-value growth-money">{money(summary?.spend ?? 0)}</div><small>Meta + Google</small></article>
        <article className="metric-card"><div className="metric-top"><span>전환 매출</span><TrendingUp size={16} /></div><div className="metric-value growth-money">{money(summary?.attributedRevenue ?? 0)}</div><small>광고 플랫폼 귀속 기준</small></article>
        <article className="metric-card"><div className="metric-top"><span>ROAS</span><BarChart3 size={16} /></div><div className="metric-value">{ratio(summary?.roas ?? 0)}</div><small>전환 매출 ÷ 광고비</small></article>
        <article className="metric-card"><div className="metric-top"><span>CPA</span><Target size={16} /></div><div className="metric-value growth-money">{money(summary?.cpa ?? 0)}</div><small>전환 {Number(summary?.conversions ?? 0).toLocaleString("ko-KR")}건</small></article>
      </section>

      <section className="ad-layout">
        <article className="panel ad-channel-panel">
          <div className="panel-header"><div><h2>채널별 성과</h2><p>동일 기간·브랜드 기준 직접 API 집계</p></div><BarChart3 size={17} /></div>
          <div className="ad-channel-table">
            <header><span>채널</span><span>광고비</span><span>전환 매출</span><span>ROAS</span><span>CPA</span></header>
            {(data?.channels ?? []).map((channel) => <div key={channel.provider}>
              <strong>{channel.provider === "meta" ? "Meta" : "Google"}</strong>
              <span>{money(channel.spend)}</span><span>{money(channel.attributedRevenue)}</span><span>{ratio(channel.roas)}</span><span>{money(channel.cpa)}</span>
            </div>)}
          </div>
          {!data?.rows.length ? <div className="empty-state compact-empty"><div><BarChart3 /><h3>수집된 광고 데이터가 없습니다.</h3><p>광고 계정 자격 증명을 서버에 등록하면 일 1회 자동 집계됩니다.</p></div></div> : null}
        </article>

        <article className="panel ad-comparison-panel">
          <div className="panel-header"><div><h2>매출·비용 교차 확인</h2><p>OS 매출 원장과 경영지원 광고비 비교</p></div><CircleDollarSign size={17} /></div>
          <div className="ad-comparison-values">
            <div><span>OS 순매출</span><strong>{money(summary?.operatingRevenue ?? 0)}</strong></div>
            <div><span>API 광고비</span><strong>{money(summary?.spend ?? 0)}</strong></div>
            <div><span>재무 광고비</span><strong>{summary?.financeAdExpense == null ? "권한 필요" : money(summary.financeAdExpense)}</strong></div>
          </div>
          <p className="ad-note">광고 플랫폼 전환 매출은 귀속 모델 기준이며 실제 OS 순매출과 다를 수 있습니다. 차이를 함께 보고 수익성을 판단합니다.</p>
          <div className="ad-external-links"><a href="https://adsmanager.facebook.com/" target="_blank" rel="noreferrer">Meta 광고 관리자 <ExternalLink size={13} /></a><a href="https://ads.google.com/" target="_blank" rel="noreferrer">Google Ads <ExternalLink size={13} /></a></div>
        </article>
      </section>

      {daily.length ? <section className="panel ad-daily-panel"><div className="panel-header"><div><h2>최근 일별 집계</h2><p>선택한 월에서 최근 14일</p></div></div><div className="ad-daily-list">{daily.map(([date, value]) => <div key={date}><time>{date}</time><span>광고비 {money(value.spend)}</span><strong>전환 매출 {money(value.revenue)}</strong><em>{ratio(value.spend ? value.revenue / value.spend : 0)}</em></div>)}</div></section> : null}
    </>
  );
}
