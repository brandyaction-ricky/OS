"use client";

import { BarChart3, CircleAlert, CircleDollarSign, ExternalLink, FileUp, RefreshCw, Target, TrendingUp } from "lucide-react";
import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { getAdPerformance, importPerformanceCsv, syncAdPerformance, type AdPerformanceResponse } from "@/lib/api-client";
import { parseAdCsv } from "@/lib/performance-csv";
import { usePerformanceFilters } from "./performance-filter-context";
import { useSession } from "./session-provider";

const money = (value: number) => `${(value / 10_000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}만원`;
const ratio = (value: number) => `${value.toFixed(2)}배`;

function downloadAdCsvSample() {
  const content = "기준일,채널,브랜드,광고비,전환매출,전환수,노출수,클릭수\n2026-08-01,meta,마이인,100000,320000,8,12000,430\n";
  const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = "ads-sample.csv"; link.click(); URL.revokeObjectURL(url);
}

export function AdPerformanceWorkspace() {
  const { accessToken, demo, profile } = useSession();
  const { brand, month } = usePerformanceFilters();
  const [data, setData] = useState<AdPerformanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (demo) return;
    setLoading(true);
    try {
      setData(await getAdPerformance(accessToken, { period: month, brand }));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "광고 성과를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, brand, demo, month]);

  useEffect(() => { load(); }, [load]);
  const connectedCount = Number(data?.connections.meta.configured) + Number(data?.connections.google.configured);

  const runSync = async () => {
    if (!data) return;
    if (!connectedCount) {
      setError("Meta·Google 광고 계정이 아직 연결되지 않았습니다. 설정 > 연결에서 자격 증명을 등록하세요.");
      return;
    }
    setSyncing(true);
    try {
      const result = await syncAdPerformance(accessToken, {
        provider: "all",
        brands: brand === "all" ? undefined : [brand],
        from: data.range.from,
        to: data.range.to,
      });
      const failures = result.result.results.filter((item) => item.status === "failed");
      if (failures.length) setError(`${failures.length}개 광고 계정 동기화에 실패했습니다. 연결 자격 증명을 확인하세요.`);
      else setNotice("광고 API 동기화를 완료했습니다.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "광고 데이터를 동기화하지 못했습니다.");
    } finally {
      setSyncing(false);
    }
  };

  const importCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const rows = parseAdCsv(await file.text());
      const result = await importPerformanceCsv(accessToken, { kind: "ads", rows });
      setNotice(`${result.imported.toLocaleString("ko-KR")}건의 광고 성과를 가져왔습니다.`);
      setError("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "광고 CSV를 가져오지 못했습니다.");
    } finally {
      event.target.value = "";
    }
  };

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
        <div className="page-title-group"><span className="eyebrow">광고 성과</span><h1>광고 성과</h1><p>Meta·Google 광고 데이터를 모아 광고비, 전환 매출, ROAS와 CPA를 비교합니다. 화면 금액은 만원 단위입니다.</p></div>
        <div className="ad-toolbar">
          {profile?.role === "admin" ? <button type="button" className="ghost-button" onClick={downloadAdCsvSample}>CSV 예제</button> : null}
          {profile?.role === "admin" ? <label className="secondary-button file-button"><FileUp size={15} /> CSV 가져오기<input type="file" accept=".csv,text/csv" onChange={importCsv} /></label> : null}
          <button className="secondary-button" disabled={loading} onClick={load}><RefreshCw size={15} className={loading ? "spin" : ""} /> 새로고침</button>
          {profile?.role === "admin" ? <button className="primary-button" disabled={syncing} onClick={runSync}><RefreshCw size={15} className={syncing ? "spin" : ""} /> API 동기화</button> : null}
        </div>
      </header>
      {error ? <div className="inline-alert danger"><CircleAlert size={16} />{error}</div> : null}
      {notice ? <div className="inline-alert success">{notice}</div> : null}

      <section className="ad-connection-strip">
        {(["meta", "google"] as const).map((provider) => {
          const connection = data?.connections[provider];
          const title = provider === "meta" ? "Meta Ads" : "Google Ads";
          return <article className="panel ad-connection" key={provider}><span className={connection?.configured ? "connected" : "waiting"}><BarChart3 size={17} /></span><div><strong>{title}</strong><small>{connection?.configured ? "읽기 전용 API 연결됨" : "광고 계정 환경변수 등록 대기"}</small></div><em className={connection?.configured ? "connected" : "waiting"}>{connection?.configured ? "연결" : "대기"}</em></article>;
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
        <article className="panel ad-channel-panel"><div className="panel-header"><div><h2>채널별 성과</h2><p>동일 기간·브랜드 기준 API·CSV 집계</p></div><BarChart3 size={17} /></div><div className="ad-channel-table"><header><span>채널</span><span>광고비</span><span>전환 매출</span><span>ROAS</span><span>CPA</span></header>{(data?.channels ?? []).map((channel) => <div key={channel.provider}><strong>{channel.provider === "meta" ? "Meta" : "Google"}</strong><span>{money(channel.spend)}</span><span>{money(channel.attributedRevenue)}</span><span>{ratio(channel.roas)}</span><span>{money(channel.cpa)}</span></div>)}</div>{!data?.rows.length ? <div className="empty-state compact-empty"><div><BarChart3 /><h3>수집된 광고 데이터가 없습니다.</h3><p>광고 계정을 연결해 API 동기화를 실행하거나 CSV로 초기 데이터를 가져오세요.</p></div></div> : null}</article>
        <article className="panel ad-comparison-panel"><div className="panel-header"><div><h2>매출·비용 교차 확인</h2><p>OS 매출 상세와 경영지원 광고비 비교</p></div><CircleDollarSign size={17} /></div><div className="ad-comparison-values"><div><span>OS 순매출</span><strong>{money(summary?.operatingRevenue ?? 0)}</strong></div><div><span>API·CSV 광고비</span><strong>{money(summary?.spend ?? 0)}</strong></div><div><span>재무 광고비</span><strong>{summary?.financeAdExpense == null ? "권한 필요" : money(summary.financeAdExpense)}</strong></div></div><p className="ad-note">광고 플랫폼 전환 매출은 귀속 모델 기준이며 실제 OS 순매출과 다를 수 있습니다. 차이를 함께 보고 수익성을 판단합니다.</p><div className="ad-external-links"><a href="https://adsmanager.facebook.com/" target="_blank" rel="noreferrer">Meta 광고 관리자 <ExternalLink size={13} /></a><a href="https://ads.google.com/" target="_blank" rel="noreferrer">Google Ads <ExternalLink size={13} /></a></div></article>
      </section>

      {daily.length ? <section className="panel ad-daily-panel"><div className="panel-header"><div><h2>최근 일별 집계</h2><p>선택한 월에서 최근 14일</p></div></div><div className="ad-daily-list">{daily.map(([date, value]) => <div key={date}><time>{date}</time><span>광고비 {money(value.spend)}</span><strong>전환 매출 {money(value.revenue)}</strong><em>{ratio(value.spend ? value.revenue / value.spend : 0)}</em></div>)}</div></section> : null}
      {profile?.role === "admin" ? <p className="csv-help">광고 CSV 열: 기준일, 채널(meta/google), 브랜드, 광고비, 전환매출, 전환수, 노출수, 클릭수</p> : null}
    </>
  );
}
