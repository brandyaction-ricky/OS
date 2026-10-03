"use client";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CircleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest, listRecords, updateRecord } from "@/lib/api-client";
import type { OsRecord } from "@/lib/record-types";
import { canMovePublication, localCalendarDate, localCalendarTime, movePublicationDate, publicationCalendarFormat, PUBLICATION_FORMATS } from "@/lib/publishing-calendar";
import { PageTitle } from "./page-title";
import { useContentWork } from "./content-work-provider";
import { PublishingTabs } from "./publishing-tabs";
import { useSession } from "./session-provider";

export function PublishingCalendarWorkspace(){
  const work=useContentWork(),{accessToken,demo}=useSession();
  const [mode,setMode]=useState<"week"|"month">("week"),[anchor,setAnchor]=useState(()=>localCalendarDate(new Date()));
  const [records,setRecords]=useState<OsRecord[]>([]),[error,setError]=useState(""),[loading,setLoading]=useState(!demo),[busy,setBusy]=useState(false);
  const load=useCallback(async()=>{if(demo)return;setLoading(true);try{const result=await listRecords(accessToken,"content_publish","limit=200");setRecords(result.records);setError("");}catch(reason){setError(reason instanceof Error?reason.message:"일정 조회 실패");}finally{setLoading(false);}},[accessToken,demo]);
  useEffect(()=>{void load();},[load]);
  const days=useMemo(()=>{
    const start=new Date(anchor+"T12:00:00");if(Number.isNaN(start.getTime()))return [];
    if(mode==="week")start.setDate(start.getDate()-((start.getDay()+6)%7));else start.setDate(1);
    const count=mode==="week"?7:new Date(start.getFullYear(),start.getMonth()+1,0).getDate();
    return Array.from({length:count},(_,index)=>{const value=new Date(start);value.setDate(start.getDate()+index);return value;});
  },[anchor,mode]);
  const visible=records.filter(row=>!work?.topicId||row.parent_id===work.topicId);
  function shift(delta:number){const next=new Date(anchor+"T12:00:00");if(mode==="week")next.setDate(next.getDate()+delta*7);else{next.setDate(1);next.setMonth(next.getMonth()+delta);}setAnchor(localCalendarDate(next));}
  async function moveRecord(id:string,date:string){
    const record=records.find(row=>row.id===id);if(!record||busy)return;
    const change=movePublicationDate(record,date);if(!change){setError("발행 완료 항목은 이동할 수 없습니다.");return;}
    setBusy(true);setError("");
    try{
      if(demo){setRecords(old=>old.map(row=>row.id===id?{...row,starts_at:change.startsAt}:row));return;}
      if(record.metadata.channelWorkflowVersion===1)await apiRequest("/api/v1/content/publish",{method:"POST",token:accessToken,body:JSON.stringify({id,expectedVersion:record.version,operation:"reschedule",startsAt:change.startsAt})});
      else await updateRecord(accessToken,{id,expectedVersion:record.version,...change});
      await load();
    }catch(reason){setError(reason instanceof Error?reason.message:"일정을 이동하지 못했습니다.");}finally{setBusy(false);}
  }
  const due=visible.filter(row=>row.status==="scheduled"&&row.starts_at&&Date.parse(row.starts_at)<=Date.now());
  const manual=visible.filter(row=>row.status!=="published"&&row.metadata.publishMode==="manual");
  const failed=visible.filter(row=>row.metadata.publishError);
  const href=(row:OsRecord)=>"/content/publishing?tab=review&publication="+encodeURIComponent(row.id)+(row.parent_id?"&sourceId="+encodeURIComponent(row.parent_id):"");
  return <>
    <header className="page-header"><div className="page-title-group"><PageTitle/><p>시각이 되면 알림을 받고, 사람이 확인한 뒤 게시합니다.</p></div></header>
    <PublishingTabs view="calendar"/>
    {error?<div className="inline-alert danger" role="alert"><CircleAlert size={16}/>{error}</div>:null}
    <div className="period-toolbar panel"><button className="icon-button" aria-label="이전 기간" onClick={()=>shift(-1)}><ArrowLeft size={16}/></button><input aria-label="발행 캘린더 기준일" type="date" value={anchor} onChange={event=>{if(event.target.value)setAnchor(event.target.value);}}/><button className="icon-button" aria-label="다음 기간" onClick={()=>shift(1)}><ArrowRight size={16}/></button><button className="ghost-button" onClick={()=>setAnchor(localCalendarDate(new Date()))}>오늘</button><button className={mode==="week"?"primary-button":"secondary-button"} onClick={()=>setMode("week")}>주</button><button className={mode==="month"?"primary-button":"secondary-button"} onClick={()=>setMode("month")}>월</button></div>
    {loading?<div className="panel loading-state" role="status">일정 불러오는 중…</div>:<div className="channel-calendar-layout">
      <section className="panel channel-calendar-scroll" aria-label="형식별 발행 캘린더"><table className={"channel-calendar-table "+mode}><thead><tr><th>게시 형식</th>{days.map(date=><th key={localCalendarDate(date)}>{date.getDate()}일 <small>{new Intl.DateTimeFormat("ko-KR",{weekday:"short"}).format(date)}</small></th>)}</tr></thead><tbody>{PUBLICATION_FORMATS.map(format=><tr key={format.id}><th scope="row">{format.label}</th>{days.map(date=>{const key=localCalendarDate(date);return <td key={key} onDragOver={event=>event.preventDefault()} onDrop={event=>void moveRecord(event.dataTransfer.getData("text/plain"),key)}>{visible.filter(row=>row.starts_at&&publicationCalendarFormat(row)===format.id&&localCalendarDate(row.starts_at)===key).map(row=><Link key={row.id} href={href(row)} className={"calendar-content "+String(row.metadata.platform??"unknown")} draggable={!busy&&canMovePublication(row.status)} onDragStart={event=>event.dataTransfer.setData("text/plain",row.id)}><strong>{row.title}</strong><time>{localCalendarTime(row.starts_at)}</time><small>{row.status==="published"?"게시됨":row.metadata.needsRecheck?"재확인 필요":row.status==="scheduled"?"확인 예약":"준비 중"}</small></Link>)}</td>;})}</tr>)}</tbody></table>{!visible.length?<p className="list-empty">등록된 발행 일정이 없습니다. 검토·발행 대기에서 먼저 예약하세요.</p>:null}{records.length===200?<p>최근 200건 범위입니다. 이전 기록은 검색에서 확인하세요.</p>:null}</section>
      <aside className="channel-calendar-alerts">{[{title:"지금 확인할 것",rows:due},{title:"앱에서 직접 할 일",rows:manual},{title:"실패 · 결과 확인",rows:failed}].map(group=><section className="panel" key={group.title}><h2>{group.title} <small>{group.rows.length}</small></h2>{group.rows.length?group.rows.map(row=><Link key={row.id} href={href(row)}>{row.title}<small>게시 설정 열기 →</small></Link>):<p>확인할 항목이 없습니다.</p>}</section>)}</aside>
    </div>}
  </>;
}
