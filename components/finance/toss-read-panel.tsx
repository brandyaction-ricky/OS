"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import type { tossConnection, tossProvider } from "@/lib/finance/toss/provider";

type Connection=ReturnType<typeof tossConnection>;
type Provider=ReturnType<typeof tossProvider>;
type Transactions=Awaited<ReturnType<Provider["transactions"]>>;
type Settlements=Awaited<ReturnType<Provider["settlements"]>>;
type Page=({kind:"transactions"}&Transactions)|({kind:"settlements"}&Settlements);
const money=(value:number)=>new Intl.NumberFormat("ko-KR").format(value)+"원";
const statusLabels:Record<string,string>={DONE:"승인",CANCELED:"취소",PARTIAL_CANCELED:"부분 취소",WAITING_FOR_DEPOSIT:"입금 대기",READY:"준비",IN_PROGRESS:"진행 중",ABORTED:"승인 실패",EXPIRED:"만료"};

/** Manual read-only preview; never merges partial upstream pages into the ledger. */
export function TossReadPanel({token,kind}:{token:string|null;kind:"transactions"|"settlements"}){
  const today=new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Seoul"});
  const [from,setFrom]=useState(today.slice(0,7)+"-01");
  const [to,setTo]=useState(today);
  const [connection,setConnection]=useState<Connection|null>(null);
  const [page,setPage]=useState<Page|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const requests=useRef({controller:null as AbortController|null,sequence:0});
  useEffect(()=>{
    const abort=new AbortController();
    setConnection(null);setError("");
    void apiRequest<Connection>("/api/v1/finance/toss/status?biz=edu",{token,signal:abort.signal})
      .then(value=>{if(!abort.signal.aborted)setConnection(value);})
      .catch(()=>{if(!abort.signal.aborted)setError("토스 연결 설정을 확인하지 못했습니다. 재로그인 후 다시 시도해 주세요.");});
    return ()=>abort.abort();
  },[token]);
  useEffect(()=>{
    const pending=requests.current;
    pending.sequence++;pending.controller?.abort();setPage(null);setBusy(false);
    return ()=>{pending.sequence++;pending.controller?.abort();};
  },[kind,from,to,token]);
  async function read(next=false){
    if(busy)return;
    const pending=requests.current,current=++pending.sequence;
    pending.controller?.abort();
    const abort=new AbortController();pending.controller=abort;
    setBusy(true);setError("");
    const query=new URLSearchParams({biz:"edu",from,to});
    if(next&&page?.next!==null&&page?.next!==undefined)query.set(kind==="transactions"?"cursor":"page",String(page.next));
    try{
      const result=await apiRequest<Page>(`/api/v1/finance/toss/${kind}?${query}`,{token,signal:abort.signal});
      if(current===pending.sequence)setPage(result);
    }catch(reason){
      if(current===pending.sequence){setPage(null);setError(reason instanceof Error?reason.message:"토스 조회에 실패했습니다.");}
    }finally{if(current===pending.sequence)setBusy(false);}
  }
  return <details className="panel finance-toss-panel">
    <summary>에듀 토스 {kind==="transactions"?"거래":"정산"} 직접 조회 · 읽기 전용</summary>
    <div className="finance-toss-body">
      <p role="status">{connection?`${connection.mode==="live"?"라이브":connection.mode==="test"?"테스트":"미연결"} · ${connection.message}`:"서버 설정 확인 중"}</p>
      <p>한 번에 최대 31일·100건을 조회합니다. 조회 결과는 원장·예산에 저장하거나 합산하지 않습니다. 결제·환불·통장 입금은 실행하지 않습니다.</p>
      <form onSubmit={event=>{event.preventDefault();void read();}}>
        <label>{kind==="transactions"?"거래":"지급 예정"} 시작일<input type="date" required value={from} onChange={event=>setFrom(event.target.value)}/></label>
        <label>종료일<input type="date" required min={from} value={to} onChange={event=>setTo(event.target.value)}/></label>
        <button className="primary-button" disabled={busy||!connection?.configured} type="submit">{busy?"조회 중…":"토스에서 조회"}</button>
      </form>
      {error?<p role="alert">{error}</p>:null}
      {page&&page.kind===kind?<>
        <p role="status">조회 성공 · 현재 페이지 {page.rows.length}건 · {page.next!==null?"다음 페이지 있음":"마지막 페이지"}</p>
        {page.kind==="settlements"?<p>지급 예정일 기준 자료입니다. 실제 통장 입금 확인과는 다릅니다. 당일 정산은 아직 제공되지 않을 수 있습니다.</p>:null}
        <div className="finance-toss-table" tabIndex={0} role="region" aria-label="토스 조회 내역">
          {page.kind==="transactions"?<table><caption>현재 페이지 거래 내역 · 전체 기간 합계가 아닙니다</caption><thead><tr><th>거래 시각 (한국)</th><th>주문번호</th><th>결제수단</th><th>상태</th><th>거래 금액</th></tr></thead><tbody>{page.rows.map(row=><tr key={row.transaction_key}><td>{new Date(row.transaction_at).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}</td><td>{row.order_id}</td><td>{row.method}</td><td>{statusLabels[row.status]||row.status}</td><td>{money(row.amount)}</td></tr>)}</tbody></table>:<table><caption>현재 페이지 정산 내역 · 실제 입금 확정 아님</caption><thead><tr><th>정산 매출일</th><th>지급 예정일</th><th>결제수단</th><th>결제 금액</th><th>수수료</th><th>지급 예정액</th></tr></thead><tbody>{page.rows.map(row=><tr key={row.transaction_key}><td>{row.sold_date}</td><td>{row.paid_out_date}</td><td>{row.method}</td><td>{money(row.amount)}</td><td>{money(row.fee)}</td><td>{money(row.pay_out_amount)}</td></tr>)}</tbody></table>}
        </div>
        {page.rows.length===0?<p>이 페이지에 조회된 자료가 없습니다. 전체 매출·입금이 0원이라는 뜻은 아닙니다.</p>:null}
        {page.next!==null?<button className="secondary-button" disabled={busy} onClick={()=>void read(true)}>다음 100건 조회</button>:null}
      </>:null}
    </div>
  </details>;
}
