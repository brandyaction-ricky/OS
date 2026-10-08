"use client";

import { useEffect,useRef,useState } from "react";
import { apiRequest } from "@/lib/api-client";
import type { publicSyncRun } from "@/lib/finance/toss/sync";

type Run=ReturnType<typeof publicSyncRun>;
type Status={enabled:boolean;connection:{configured:boolean;mode:string|null;message:string};run:Run|null};
const today=()=>new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Seoul"});
const phaseName={transactions:"결제·취소",settlements:"정산",complete:"완료"};
export function TossSyncPanel({token,onRefresh}:{token:string|null;onRefresh:()=>void}){
  const [status,setStatus]=useState<Status|null>(null);
  const [from,setFrom]=useState(()=>today().slice(0,7)+"-01");
  const [to,setTo]=useState(today);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [saved,setSaved]=useState(false);
  const [confirmed,setConfirmed]=useState(false);
  const sequence=useRef(0);
  const abort=useRef<AbortController|null>(null);
  // Sync state survives route changes/reloads in the database, not localStorage.
  useEffect(()=>{
    const id=++sequence.current,controller=new AbortController();abort.current=controller;
    setBusy(true);setStatus(null);setError("");setConfirmed(false);setSaved(false);
    void apiRequest<Status>("/api/v1/finance/toss-sync",{token,signal:controller.signal})
      .then(result=>{if(id===sequence.current)setStatus(result);})
      .catch(()=>{if(id===sequence.current)setError("수집 상태를 불러오지 못했습니다. 상태 확인을 다시 눌러 주세요.");})
      .finally(()=>{if(id===sequence.current)setBusy(false);});
    return()=>{
      // Monotonic request counter, not a DOM ref: invalidate every outstanding action.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      sequence.current++;
      controller.abort();abort.current?.abort();
    };
  },[token]);
  async function act(action:"status"|"begin"|"step"|"abandon"){
    if(busy)return;
    const id=++sequence.current,controller=new AbortController();abort.current=controller;
    setBusy(true);setError("");
    try{
      if(action==="status"){
        const next=await apiRequest<Status>("/api/v1/finance/toss-sync",{token,signal:controller.signal});
        if(id===sequence.current)setStatus(next);
      }else{
        const body=action==="begin"?{action,from,to}:{action,runId:status?.run?.id};
        const next=await apiRequest<{run:Run;persisted:boolean}>("/api/v1/finance/toss-sync",{token,signal:controller.signal,method:"POST",body:JSON.stringify(body)});
        if(id===sequence.current){
          setStatus(old=>old?{...old,run:next.run}:old);
          if(next.persisted)setSaved(true);
          if(action==="begin")setConfirmed(false);
        }
      }
    }catch(reason){if(id===sequence.current)setError(reason instanceof Error?reason.message:"이번 묶음을 완료하지 못했습니다. 상태 확인 후 이어받을 수 있습니다.");}
    finally{if(id===sequence.current)setBusy(false);}
  }
  const run=status?.run,active=run?.state==="running";
  const days=(Date.parse(to)-Date.parse(from))/86400000;
  const valid=Number.isFinite(days)&&days>=0&&days<=30&&to<=today();
  const ready=status?.enabled&&status.connection.configured;
  return <section className="panel finance-toss-sync" aria-label="에듀 토스 원장 수집" aria-busy={busy}>
    <div className="panel-header"><h2>에듀 · 토스 원장 수집</h2><span className="finance-sync-mode">{status?.connection.mode==="live"?"라이브":status?.connection.mode==="test"?"테스트":"미설정"} · 수동 수집</span></div>
    <div className="finance-sync-body">
      <p>결제·취소와 정산 내역을 재무 원장에 저장합니다. 실제 결제·환불은 실행하지 않으며, 통장 입금은 별도로 확인합니다.</p>
      {!status?<p role="status">수집 상태를 확인하고 있습니다.</p>:!status.enabled?<p role="status">원장 수집은 검수·승인 후 활성화됩니다. 기존 토스 조회는 저장 없이 사용할 수 있습니다.</p>:!status.connection.configured?<p role="status">{status.connection.message}</p>:null}
      {!active?<form className="finance-sync-form" onSubmit={event=>{event.preventDefault();void act("begin");}}>
        <label>시작일<input type="date" value={from} max={to} disabled={busy||!ready} onChange={event=>{setFrom(event.target.value);setConfirmed(false);}}/></label>
        <label>종료일<input type="date" value={to} min={from} max={today()} disabled={busy||!ready} onChange={event=>{setTo(event.target.value);setConfirmed(false);}}/></label>
        <label className="finance-sync-confirm"><input type="checkbox" checked={confirmed} disabled={busy||!ready} onChange={event=>setConfirmed(event.target.checked)}/>선택 기간의 에듀 자료를 원장에 저장합니다</label>
        <button className="primary-button" disabled={busy||!ready||!confirmed||!valid} type="submit">수집 시작</button>
      </form>:null}
      {ready&&!active&&!valid?<p className="finance-sync-warning">오늘까지 최대 31일을 선택해 주세요.</p>:null}
      {run?<div className="finance-sync-progress" role="status">
        <strong>{run.state==="complete"?"선택 기간 수집 완료":run.state==="abandoned"?"수집 종료 · 저장된 묶음 유지":`${phaseName[run.phase]} 수집 중 · 아직 전체 완료 아님`}</strong>
        <span>{run.date_from} ~ {run.date_to} · 거래 발생일 / 정산 지급일 기준</span>
        <span>거래 {run.transaction_count}건 · 결제 처리 {run.payment_count}건 · 취소 처리 {run.cancel_count}건 · 정산 처리 {run.settlement_count}건 · 제외 {run.skipped_count}건</span>
        <small>처리 건수는 재조회·갱신을 포함합니다. 완료는 선택 기간 기준이며, 오늘 정산은 토스에서 아직 제공하지 않을 수 있습니다.</small>
        <small>마지막 저장 {new Date(run.updated_at).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}</small>
        {run.last_error_code?<span className="finance-sync-warning">마지막 묶음이 실패했습니다. 이전 저장분은 유지되며 같은 위치에서 이어받습니다.</span>:null}
      </div>:null}
      <div className="finance-sync-actions">
        {active?<><button className="primary-button" disabled={busy||!ready} onClick={()=>void act("step")}>{busy?"한 묶음 처리 중…":"다음 묶음 수집 / 이어받기"}</button><button className="secondary-button" disabled={busy||!ready} onClick={()=>void act("abandon")}>수집 종료 · 저장분 유지</button></>:null}
        <button className="secondary-button" disabled={busy} onClick={()=>void act("status")}>상태 확인</button>
        <button className="secondary-button" disabled={busy||!(saved||run?.page_count)} onClick={()=>{onRefresh();setSaved(false);}}>저장 원장 새로고침</button>
      </div>
      {active?<p className="finance-sync-note">버튼 한 번에 결제 최대 10건 또는 정산 100건을 처리합니다. 화면을 닫아도 저장한 위치에서 이어받을 수 있습니다. 기간을 바꾸려면 현재 수집을 종료해 주세요.</p>:null}
      {saved?<p role="status">묶음 저장됨 · ‘저장 원장 새로고침’을 누르면 아래 재무 화면에 반영됩니다.</p>:null}
      {error?<p role="alert" className="finance-sync-warning">{error}</p>:null}
    </div>
  </section>;
}
