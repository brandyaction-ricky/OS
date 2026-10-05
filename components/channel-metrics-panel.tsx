"use client";
import Link from "next/link";
import { useState } from "react";
import { METRIC_LABELS, YOUTUBE_ANALYTICS_METRICS, compareMetricSamples, sampleSummary, metricSamples, measuredValue, type Snapshot } from "@/lib/channel-metrics";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";
import { demoRecord } from "@/lib/demo-record";
export function ChannelMetricsPanel({records,loading,youtubeOnly=false}:{records:OsRecord[];loading:boolean;youtubeOnly?:boolean}){
  const {demo,profile}=useSession();
  const [platform,setPlatform]=useState("all"),[snapshot,setSnapshot]=useState<Snapshot>("d7"),[metric,setMetric]=useState("views"),[examples,setExamples]=useState<OsRecord[]>([]);
  const [from,setFrom]=useState(""),[to,setTo]=useState("");
  const data=demo?examples:records;
  const youtube=platform==="yt_long"||platform==="yt_shorts";
  const kinds = youtubeOnly ? ["yt_long", "yt_shorts"] : ["instagram", "threads"];
  const samples=metricSamples(data,metric,from,to);
  const visible=samples.filter(row=>row.metadata.snapshot===snapshot&&(platform==="all"||row.metadata.platform===platform));
  const values=(kind:string)=>visible.filter(row=>row.metadata.platform===kind).map(row=>measuredValue(row.metadata.value)!).filter(Number.isFinite);
  const latest=data.map(row=>String(row.metadata.measuredAt??"")).sort().at(-1);
  const number=(value:number|null)=>value===null?"—":value.toLocaleString("ko-KR",{maximumFractionDigits:1});
  const loadExamples=()=>setExamples(kinds.flatMap(kind=>Array.from({length:6},(_,index)=>demoRecord({recordType:"content_metric",title:`모의 ${kind} 게시물 ${index+1}`,metadata:{source:"api",platform:kind,snapshot:"d7",metric:"views",value:100+index*20+(kind==="threads"||kind==="yt_shorts"?50:0),publishId:`${kind}-${index}`,publishedAt:new Date(Date.now()-7*86400000).toISOString(),measuredAt:new Date().toISOString(),mock:true}},profile?.id??"demo"))));
  return <section className="panel channel-metrics-panel" aria-label="게시 후 경과일 비교"><header><div><h2>게시 후 경과일 비교</h2><p>같은 경과일의 API 스냅샷끼리 비교합니다. 놓친 날짜의 수치를 현재 값으로 채우지 않습니다.</p></div>{demo?<button className="secondary-button" onClick={loadExamples}>모의 성과 불러오기</button>:null}</header>
    <nav className="studio-tabs" aria-label="성과 플랫폼">{(youtubeOnly ? [["all","전체"],["yt_long","유튜브 롱폼"],["yt_shorts","유튜브 쇼츠"]] : [["all","전체"],["yt_long","유튜브 롱폼"],["yt_shorts","유튜브 쇼츠"],["instagram","인스타"],["threads","Threads"]]).map(([value,label])=><button key={value} className={platform===value?"active":""} onClick={()=>setPlatform(value)}>{label}</button>)}</nav>
    <div className="channel-metric-filters"><label>경과일<select value={snapshot} onChange={event=>setSnapshot(event.target.value as Snapshot)}><option value="d1">D1 · 게시 후 1일</option><option value="d7">D7 · 게시 후 7일</option><option value="d28">D28 · 게시 후 28일</option></select></label><label>지표<select value={metric} onChange={event=>setMetric(event.target.value)}>{Object.entries(METRIC_LABELS).filter(([value])=>!youtubeOnly||(YOUTUBE_ANALYTICS_METRICS as readonly string[]).includes(value)).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>게시 시작일<input type="date" value={from} onChange={event=>setFrom(event.target.value)}/></label><label>게시 종료일<input type="date" value={to} onChange={event=>setTo(event.target.value)}/></label></div>
    {loading?<p role="status">성과 불러오는 중…</p>:youtube&&!youtubeOnly?<p className="inline-alert">YouTube 분석 미연결 · 업로드 연결과 분석 권한은 다릅니다. <Link href="/settings/account">내 계정에서 연결 확인 →</Link></p>:<>
      <div className="channel-metric-samples">{kinds.filter(kind=>platform==="all"||platform===kind).map(kind=>{const stats=sampleSummary(values(kind));return <article key={kind}><h3>{kind==="yt_long"?"유튜브 롱폼":kind==="yt_shorts"?"유튜브 쇼츠":kind==="instagram"?"인스타":"Threads"} · {snapshot.toUpperCase()}</h3><strong>{number(stats.median)}</strong><p>{METRIC_LABELS[metric]} 중앙값 · n={stats.n}개 게시물</p><small>범위 {number(stats.min)}~{number(stats.max)} · {stats.n<5?"비교 보류":"표본 5개 이상"}</small></article>;})}</div>
      {platform==="all"&&!youtubeOnly?<p>{compareMetricSamples(values("instagram"),values("threads"))} · 플랫폼별 집계 정의 차이를 고려해야 합니다.</p>:null}
      <p className="channel-collection-status">{demo?"모의 수치 · 실제 API 호출 없음":latest?`마지막 저장 ${new Date(latest).toLocaleString("ko-KR")} · 현재 수집 성공 여부는 작동 상태에서 확인`:"아직 수집된 스냅샷 없음 · 채널 연결·권한·수집 작업 준비를 확인해 주세요."}</p>
      <div className="channel-metric-table"><table aria-label="경과일별 성과 비교"><thead><tr><th>플랫폼</th>{(["d1","d7","d28"] as const).map(day=><th key={day}>{day.toUpperCase()} · {METRIC_LABELS[metric]}</th>)}</tr></thead><tbody>{kinds.filter(kind=>platform==="all"||platform===kind).map(kind=><tr key={kind}><th scope="row">{kind==="yt_long"?"유튜브 롱폼":kind==="yt_shorts"?"유튜브 쇼츠":kind==="instagram"?"인스타":"Threads"}</th>{(["d1","d7","d28"] as const).map(day=>{const stats=sampleSummary(samples.filter(row=>row.metadata.platform===kind&&row.metadata.snapshot===day).map(row=>measuredValue(row.metadata.value)!));return <td key={day}><strong>{number(stats.median)}</strong><small>중앙값 · n={stats.n}<br/>범위 {number(stats.min)}~{number(stats.max)}{stats.n<5?" · 비교 보류":""}</small></td>;})}</tr>)}</tbody></table><p>경과일별 표본이 다를 수 있습니다. ‘—’는 미측정이며 0으로 대체하지 않습니다.</p></div>
      <div className="channel-metric-table"><table aria-label="선택 경과일 측정 기록"><thead><tr><th>게시물</th><th>플랫폼</th><th>경과일</th><th>{METRIC_LABELS[metric]}</th><th>출처</th></tr></thead><tbody>{visible.map(row=><tr key={row.id}><td>{row.title}</td><td>{String(row.metadata.platform)}</td><td>{String(row.metadata.snapshot).toUpperCase()}</td><td>{number(measuredValue(row.metadata.value))}</td><td>{row.metadata.mock?"모의 API":"API"}</td></tr>)}</tbody></table>{!visible.length?<p>선택 범위의 측정값이 없습니다. 미측정은 0이 아닙니다.</p>:null}</div>
    </>}
    <p>{youtubeOnly?"수기·기존 YouTube 기록은 아래 측정 기록에 그대로 보관합니다.":"수기·기존 기록은 아래 측정 기록에 그대로 보관합니다. 인스타 자동 수집에 impressions는 사용하지 않습니다."}</p>
  </section>;
}
