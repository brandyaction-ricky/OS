"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { canonicalRuleKinds, canonicalRunLabels, type CanonicalRun, type CanonicalSource } from "@/lib/canonical-workflow";
import type { KnowledgeDocument } from "@/lib/types";
import { useSession } from "./session-provider";

type Workspace = {source:CanonicalSource|null;runs:CanonicalRun[];canConfigure:boolean;apiConfigured:boolean;autoSyncConfigured:boolean;allowedHosts:string[]};
const sourceLabels:Record<string,string>={not_checked:"아직 확인 안 함",checking:"확인 중",unchanged:"원문 동일",proposed:"변경 제안 생성",failed:"확인 실패"};

export function KnowledgeCanonicalActions({document,onSkillSaved}:{document:KnowledgeDocument;onSkillSaved:()=>void}){
  const {demo,accessToken}=useSession();const [data,setData]=useState<Workspace|null>(null);
  const [loading,setLoading]=useState(!demo),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [url,setUrl]=useState(""),[enabled,setEnabled]=useState(false),[dirty,setDirty]=useState(false);
  const [file,setFile]=useState<{name:string;content:string}|null>(null),[mode,setMode]=useState("queue");
  const active=useRef(true),sequence=useRef(0);
  useEffect(()=>{active.current=true;return()=>{active.current=false;sequence.current+=1;};},[]);
  const load=useCallback(async()=>{
    if(demo||!accessToken)return;const generation=++sequence.current;setLoading(true);
    try{const result=await apiRequest<Workspace>(`/api/v1/knowledge/canonical?documentId=${document.id}`,{token:accessToken});if(active.current&&generation===sequence.current){setData(result);setError("");}}
    catch(reason){if(active.current&&generation===sequence.current)setError(reason instanceof Error?reason.message:"작업 이력을 불러오지 못했습니다.");}
    finally{if(active.current&&generation===sequence.current)setLoading(false);}
  },[demo,accessToken,document.id]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{if(data&&!dirty){setUrl(data.source?.url??"");setEnabled(data.source?.enabled??false);}},[data,dirty]);
  const act=async(input:Record<string,unknown>)=>{
    if(busy||demo)return;setBusy(true);setError("");setNotice("");
    try{
      const result=await apiRequest<{run?:CanonicalRun;skillId?:string}>("/api/v1/knowledge/canonical",{token:accessToken,method:"POST",body:JSON.stringify({...input,documentId:document.id,expectedVersion:document.current_version})});
      if(!active.current)return;
      if(input.action==="source")setDirty(false);
      if(result.skillId){setNotice("개인 Skill 초안으로 저장했습니다. 회사 적용은 별도 검토가 필요합니다.");onSkillSaved();}
      else if(result.run?.status==="queued")setNotice("구독 대기열에 저장했습니다. 연결된 워커가 처리해야 결과가 표시됩니다.");
      else if(result.run?.result.unchanged)setNotice("원문이 같습니다. 정본과 버전을 변경하지 않았습니다.");
      else if(result.run?.result.proposalId){setNotice("변경 제안을 만들었습니다. 승인 전까지 회사 정본은 그대로입니다.");setFile(null);}
      else setNotice(input.action==="source"?"원문 연결 설정을 저장했습니다.":"작업 이력을 확인해 주세요.");
      await load();
    }catch(reason){if(active.current)setError(reason instanceof Error?reason.message:"작업을 저장하지 못했습니다. 입력은 유지됩니다.");}
    finally{if(active.current)setBusy(false);}
  };
  const disabled=demo||busy||loading||!data;
  return <section className="canonical-actions" aria-label="정본 동기화와 규칙 추출">
    <header><div><h3>원문 연결 · 규칙 추출</h3><p>외부 변경은 승인 전까지 제안으로, 추출 결과는 실행 전까지 초안으로 보관합니다.</p></div><button className="secondary-button" disabled={demo||busy||loading} onClick={()=>void load()}>작업 이력 새로고침</button></header>
    {demo?<p className="inline-alert">데모에서는 외부 원문·AI를 호출하거나 작업을 저장하지 않습니다. 실제 DEV 연결 후 검수할 수 있습니다.</p>:null}
    {loading?<p role="status">작업 이력 불러오는 중…</p>:null}
    {error?<p role="alert" className="inline-alert danger">{error}</p>:null}
    {notice?<p role="status" className="inline-alert">{notice}</p>:null}
    <div className="canonical-action-grid">
      <details><summary>외부 원문 연결</summary><p>공개 Markdown·텍스트만 지원합니다. 비공개 Notion·Drive 연결은 지원하지 않습니다.</p>
        {data?.source?<p>{sourceLabels[data.source.last_status]??"확인 필요"} · {data.source.checked_at?new Date(data.source.checked_at).toLocaleString("ko-KR"):"최근 확인 없음"}</p>:null}
        <label>HTTPS 원문 주소<input type="url" value={url} disabled={disabled||!data?.canConfigure} onChange={event=>{setUrl(event.target.value);setDirty(true);}} placeholder="https://허용된-호스트/원문.md"/></label>
        <label>자동 동기화<select value={enabled?"on":"off"} disabled={disabled||!data?.canConfigure} onChange={event=>{setEnabled(event.target.value==="on");setDirty(true);}}><option value="off">사용 안 함</option><option value="on">매일 최대 3개 원문을 순차 확인</option></select></label>
        <p>{data?.autoSyncConfigured?"예약 작업이 활성화되어 있습니다.":"서버 예약 동기화는 꺼져 있습니다. 설정 저장만으로 예약 작업이 실행되지 않습니다."}</p>
        <small>허용 호스트: {data?.allowedHosts.join(", ")||"미설정"}. 외부 연결 설정·실행은 관리자만 가능합니다.</small>
        <div className="header-actions"><button className="secondary-button" disabled={disabled||!data?.canConfigure||!url.trim()} onClick={()=>void act({action:"source",url,enabled,expectedRevision:data?.source?.revision??0})}>연결 설정 저장</button><button className="secondary-button" disabled={disabled||!data?.canConfigure||!data?.source||dirty} onClick={()=>void act({action:"sync"})}>원문 변경 확인</button></div>
      </details>
      <details><summary>파일로 변경 제안</summary><p>로컬 Markdown·텍스트를 읽어 현재 정본의 변경 제안을 만듭니다. 기존 속성·승인 상태는 보존합니다.</p>
        <label>원문 파일<input type="file" accept=".md,.txt,text/plain,text/markdown" disabled={disabled} onChange={async event=>{const upload=event.target.files?.[0];if(!upload)return;setError("");if(upload.size>500_000||!(/\.(md|txt)$/i.test(upload.name))){setError("500KB 이하 Markdown·텍스트 파일을 선택해 주세요.");event.target.value="";return;}try{const content=(await upload.text()).replace(/^\uFEFF/,"").replace(/\r\n/g,"\n");if(active.current)setFile({name:upload.name,content});}catch{if(active.current)setError("파일을 읽지 못했습니다.");}}}/></label>
        {file?<p>{file.name} · {file.content.length.toLocaleString()}자</p>:null}
        <button className="secondary-button" disabled={disabled||!file?.content.trim()} onClick={()=>void act({action:"sync",content:file?.content})}>파일 내용으로 변경 제안</button>
      </details>
      <section aria-label="규칙 추출 요청"><h4>규칙 문장 뽑기</h4><p>현재 승인된 v{document.current_version}에서만 추출합니다. 인용·줄 번호를 검증하고 자동으로 회사 규칙을 확정하지 않습니다.</p>
        <label>처리 방식<select value={mode} disabled={disabled} onChange={event=>setMode(event.target.value)}><option value="queue">구독 대기열</option><option value="api" disabled={!data?.apiConfigured}>바로 받기 · API 비용 발생</option></select></label>
        <p>{mode==="queue"?"요청자 소유의 구독 워커를 별도로 연결해야 처리됩니다.":"현재 정본 본문을 설정된 Claude API로 전송합니다. API 비용이 발생합니다."}</p>
        <button className="primary-button" disabled={disabled||(mode==="api"&&!data?.apiConfigured)} onClick={()=>void act({action:"extract",mode})}>{busy?"처리 중…":"규칙 추출 요청"}</button>
      </section>
    </div>
    <h4>내 작업 이력</h4><p>최근 30건 · 결과는 현재 읽을 수 있는 정본에서만 열립니다.</p>
    {!data?.runs.length?<p className="quiet-state">아직 동기화·추출 작업이 없습니다.</p>:data.runs.map(run=><article className="canonical-run" key={run.id}>
      <header><strong>{run.kind==="sync"?"원문 동기화":"규칙 추출"} · v{run.source_version}</strong><span>{canonicalRunLabels[run.status]}</span><small>{new Date(run.created_at).toLocaleString("ko-KR")}</small></header>
      {run.source_version!==document.current_version?<p className="inline-alert">현재 정본 버전과 다릅니다. 이 결과로 규칙을 저장할 수 없습니다.</p>:null}
      {run.status==="queued"?<p>구독 워커 처리 대기 중입니다. 요청만 저장한 상태이며 추출 완료가 아닙니다.</p>:null}
      {run.kind==="rules"&&(run.status==="queued"||run.status==="running")?<button className="secondary-button" disabled={disabled} onClick={()=>void act({action:"cancel",runId:run.id})}>{run.status==="queued"?"대기 작업 취소":"응답 없는 작업 중단 (10분 이후)"}</button>:null}
      {run.status==="failed"?<p role="status">처리에 실패했습니다. 원문·연결을 확인하세요. ({run.error_code})</p>:null}
      {run.status==="failed"&&run.kind==="rules"?<button className="secondary-button" disabled={disabled} onClick={()=>void act({action:"extract",mode:"queue",retryRunId:run.id})}>구독 대기열로 재요청</button>:null}
      {run.result.proposalId?<Link className="secondary-button" href={`/knowledge/review?proposal=${encodeURIComponent(run.result.proposalId)}`}>변경 제안 검토</Link>:null}
      {run.result.unchanged?<p>원문 동일 · 정본을 변경하지 않았습니다.</p>:null}
      {run.kind==="rules"&&run.status==="done"&&!run.result.rules?.length?<p>원문에서 확인되는 실행 규칙이 없습니다.</p>:null}
      {run.result.rules?.map((rule,index)=><div className="canonical-rule" key={index}><div><strong>{rule.text}</strong><small>{canonicalRuleKinds[rule.kind]} · {rule.channels.join(" · ")} · 원문 {rule.lineStart}–{rule.lineEnd}줄</small><blockquote>{rule.quote}</blockquote></div><button className="secondary-button" disabled={disabled||run.source_version!==document.current_version||Boolean(run.result.skillIds?.[index])} onClick={()=>void act({action:"adopt",runId:run.id,index})}>{run.result.skillIds?.[index]?"초안 저장됨":"Skill 초안으로 저장"}</button></div>)}
    </article>)}
  </section>;
}
