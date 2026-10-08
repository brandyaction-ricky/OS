"use client";
import Link from "next/link";
import {MeetingCapture} from "./meeting-capture";
import { useRouter,useSearchParams } from "next/navigation";
import { useEffect,useRef,useState } from "react";
import { Header,Card,Empty,Modal,NewDocumentButton } from "./ui";
import { useKnowledge } from "./provider";
import { kstDay,kstTime,type Meeting,type MeetingItem } from "@/lib/knowledge/model";
import { MarkdownView } from "@/components/knowledge-workspace";
import { apiRequest } from "@/lib/api-client";

const STATUSES={planned:"준비",active:"진행",review:"검수 대기",done:"완료"};
export function KnowledgeMeetings(){
  const {state}=useKnowledge(),params=useSearchParams(),router=useRouter();
  const view=params.get("view")??"table",status=params.get("status")??"all";
  const [q,setQ]=useState(""),[month,setMonth]=useState(kstDay().slice(0,7));
  const rows=state.meetings.filter(m=>(status==="all"||m.status===status)&&m.title.toLowerCase().includes(q.toLowerCase())).sort((a,b)=>(b.starts_at??b.updated_at).localeCompare(a.starts_at??a.updated_at));
  function query(patch:Record<string,string>){const next=new URLSearchParams(params);Object.entries(patch).forEach(([k,v])=>next.set(k,v));router.replace(`/knowledge/meetings?${next}`);}
  const card=(m:Meeting)=><article className="kw-card" key={m.id}><Link href={`/knowledge/meetings/${m.id}`}><strong>{m.title}</strong></Link><p><small>{m.starts_at?kstTime(m.starts_at):"일정 미정"} · {m.attendees.length}명</small></p><small>{m.metadata.visibility==="attendees"?"참석자만":"팀 공개"}</small></article>;
  const [year,mon]=month.split("-").map(Number),count=new Date(Date.UTC(year,mon,0)).getUTCDate(),first=new Date(Date.UTC(year,mon-1,1)).getUTCDay();
  return <><Header title="회의록" description="안건에서 메모, 결정과 할 일까지 한 흐름으로 기록합니다."><NewDocumentButton space="meeting" label="새 회의"/></Header><div className="kw-toolbar"><input aria-label="회의 검색" placeholder="회의 제목 검색" value={q} onChange={e=>setQ(e.target.value)}/><select aria-label="회의 상태" value={status} onChange={e=>query({status:e.target.value})}><option value="all">전체 상태</option>{Object.entries(STATUSES).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select><div className="kw-actions">{[["table","표"],["calendar","달력"],["board","보드"]].map(([value,label])=><button key={value} aria-pressed={view===value} onClick={()=>query({view:value})}>{label}</button>)}</div></div>
    {view==="calendar"?<Card title="회의 일정"><label>월<input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label><div className="kw-meeting-calendar">{["일","월","화","수","목","금","토"].map(d=><strong key={d}>{d}</strong>)}{Array.from({length:first},(_,i)=><span key={`empty-${i}`}/>)}{Array.from({length:count},(_,i)=>{const day=`${month}-${String(i+1).padStart(2,"0")}`;return <section key={day}><small>{i+1}</small>{rows.filter(m=>m.starts_at&&kstDay(new Date(m.starts_at))===day).map(card)}</section>;})}</div>{rows.some(m=>!m.starts_at)&&<><h3>일정 미정</h3>{rows.filter(m=>!m.starts_at).map(card)}</>}</Card>
    :view==="board"?<div className="kw-board">{Object.entries(STATUSES).map(([key,label])=><section key={key}><h3>{label} <small>{rows.filter(m=>m.status===key).length}</small></h3>{rows.filter(m=>m.status===key).map(card)}</section>)}</div>
    :<div className="kw-table-wrap"><table className="kw-table"><thead><tr><th>회의</th><th>일정</th><th>상태</th><th>참석자</th><th>공개 범위</th></tr></thead><tbody>{rows.map(m=><tr key={m.id}><td><Link href={`/knowledge/meetings/${m.id}`}>{m.title}</Link></td><td>{m.starts_at?kstTime(m.starts_at):"미정"}</td><td><span className="kw-badge">{STATUSES[m.status]}</span></td><td>{m.attendees.map(id=>state.people.find(p=>p.id===id)?.display_name??"구성원").join(", ")}</td><td>{m.metadata.visibility==="attendees"?"참석자만":"팀 공개"}</td></tr>)}</tbody></table>{!rows.length&&<Empty>표시할 회의가 없습니다</Empty>}</div>}</>;
}
export function KnowledgeMeetingPage({id}:{id:string}){
  const {state,loading}=useKnowledge();const meeting=state.meetings.find(m=>m.id===id);
  if(loading)return <Empty>회의를 불러오는 중입니다</Empty>;
  if(!meeting)return <Empty>이 회의를 볼 권한이 없습니다</Empty>;
  return <MeetingEditor key={meeting.id} meeting={meeting}/>;
}
function MeetingEditor({meeting:m}:{meeting:Meeting}){
  const {state,actor,command,notify,demo,token}=useKnowledge(),router=useRouter();
  function openLink(target:string){const doc=state.documents.find(d=>d.id===target||d.title===target);if(doc)router.push(doc.meeting_record_id?`/knowledge/meetings/${doc.meeting_record_id}`:`/knowledge/${doc.status==="canonical"?"canon":"doc"}/${doc.id}`);else notify("이 문서를 볼 권한이 없습니다.");}
  const [summary,setSummary]=useState(m.metadata.summary??"");
  const [title,setTitle]=useState(m.title),[content,setContent]=useState(m.description),[agenda,setAgenda]=useState(m.metadata.agenda);
  const [items,setItems]=useState(m.metadata.items),[itemText,setItemText]=useState(""),[kind,setKind]=useState<"decision"|"task">("decision");
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[dialog,setDialog]=useState<"start"|"correct"|"attendees"|null>(null);
  const inFlight=useRef(false),latestSave=useRef<()=>void>(()=>{});
  const [reason,setReason]=useState(""),[correction,setCorrection]=useState(""),[attendees,setAttendees]=useState(m.attendees),[visibility,setVisibility]=useState(m.metadata.visibility);
  const [startsAt,setStartsAt]=useState(m.starts_at?new Date(new Date(m.starts_at).getTime()+9*3600000).toISOString().slice(0,16):"");
  const owner=m.owner_id===actor.ownerId||actor.role==="admin";
  const canEdit=m.status!=="done"&&(m.attendees.includes(actor.ownerId)||actor.role==="admin")&&(m.status!=="review"||owner);
  const dirty=summary!==(m.metadata.summary??"")||(startsAt?new Date(startsAt+"+09:00").toISOString():null)!==(m.starts_at?new Date(m.starts_at).toISOString():null)||title!==m.title||content!==m.description||agenda!==m.metadata.agenda||JSON.stringify(items)!==JSON.stringify(m.metadata.items);
  useEffect(()=>{function guard(e:BeforeUnloadEvent){if(dirty){e.preventDefault();e.returnValue="";}}window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);},[dirty]);
  async function execute(action:string,extras:Record<string,unknown>={},automatic=false){
    if(inFlight.current)return false;inFlight.current=true;
    setBusy(true);setError("");
    try{
      let version=m.version;
      if(dirty&&action!=="meeting.save"){await command({action:"meeting.save",id:m.id,expectedVersion:version,title,content,agenda,items,summary,startsAt:startsAt?new Date(startsAt+"+09:00").toISOString():null});version++;}
      await command({action,id:m.id,expectedVersion:version,...(action==="meeting.save"?{title,content,agenda,items,summary,startsAt:startsAt?new Date(startsAt+"+09:00").toISOString():null}:{}),...extras});
      if(!automatic){setDialog(null);notify(action==="meeting.review"?"검수를 완료했습니다. 채택한 결정·할 일을 확정했습니다.":"회의 기록을 저장했습니다.");}
      return true;
    }catch(e){setError((e as Error).message);return false;}finally{setBusy(false);inFlight.current=false;}
  }
  const saveBeforeNavigation=useRef<(href:string)=>void>(()=>{});
  saveBeforeNavigation.current=href=>{void execute("meeting.save",{},true).then(saved=>{if(saved)router.push(href);});};
  useEffect(()=>{
    if(!dirty||!canEdit)return;
    function guardNavigation(event:MouseEvent){
      if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      const anchor=(event.target as Element)?.closest?.("a[href]") as HTMLAnchorElement|null;
      if(!anchor||anchor.target||anchor.hasAttribute("download")||anchor.origin!==location.origin||anchor.href===location.href||anchor.getAttribute("href")?.startsWith("#"))return;
      event.preventDefault();event.stopImmediatePropagation();saveBeforeNavigation.current(anchor.pathname+anchor.search+anchor.hash);
    }
    document.addEventListener("click",guardNavigation,true);return()=>document.removeEventListener("click",guardNavigation,true);
  },[dirty,canEdit]);
  latestSave.current=()=>{void execute("meeting.save",{},true);};
  useEffect(()=>{if(!dirty||!canEdit||busy||error||dialog)return;const timer=setTimeout(()=>latestSave.current(),1500);return()=>clearTimeout(timer);},[title,content,agenda,items,summary,startsAt,dirty,canEdit,busy,error,dialog]);
  useEffect(()=>{setStartsAt(m.starts_at?new Date(new Date(m.starts_at).getTime()+9*3600000).toISOString().slice(0,16):"");},[m.starts_at]);
  async function nextMeeting(){setBusy(true);try{const result=await command({action:"meeting.create",title:m.title+" · 다음 회의",previousMeetingId:m.id});if(result.id)router.push("/knowledge/meetings/"+result.id);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  function addItem(){if(!itemText.trim())return;setItems([...items,{id:crypto.randomUUID(),kind,text:itemText.trim(),state:"pending",source:"manual",addedBy:actor.ownerId}]);setItemText("");}
  async function summarize(){
    if(!content.trim())return;setBusy(true);
    try{
      if(demo)throw new Error("로컬 데모에서는 AI를 호출하지 않습니다. 결정·할 일을 직접 추가하여 검수할 수 있습니다.");
      // Use the existing scoped summary contract; failures never manufacture results.
      const result=await apiRequest<{summary?:string;decisions?:string[];todos?:Array<{title:string}>;mode:"ai"|"local"}>("/api/v1/meeting-summary",{method:"POST",token,body:JSON.stringify({transcript:content,meetingDate:m.starts_at?kstDay(new Date(m.starts_at)):kstDay()})});
      if(result.summary)setSummary(result.summary);
      setItems([...items,...(result.decisions??[]).map(text=>({id:crypto.randomUUID(),kind:"decision" as const,text,state:"pending" as const,source:"ai" as const,addedBy:actor.ownerId})),...(result.todos??[]).map(t=>({id:crypto.randomUUID(),kind:"task" as const,text:t.title,state:"pending" as const,source:"ai" as const,addedBy:actor.ownerId}))]);
      notify(result.mode==="ai"?"AI 초안을 확인하고 채택 여부를 선택해 주세요.":"AI 연결을 사용할 수 없어 규칙 기반 추출을 표시했습니다. 원문과 대조해 주세요.");
    }catch(e){notify((e as Error).message);}finally{setBusy(false);}
  }
  return <><Header title={m.title} description={`${STATUSES[m.status]} · ${m.metadata.visibility==="attendees"?"참석자만 열람":"팀 공개"} · v${m.version}`}><Link href="/knowledge/meetings">회의 목록</Link>{m.status==="done"&&<button disabled={busy} onClick={()=>void nextMeeting()}>다음 회의 만들기</button>}{m.metadata.previousMeetingId&&<Link href={"/knowledge/meetings/"+m.metadata.previousMeetingId}>이전 회의</Link>}{canEdit&&<button className="kw-primary" disabled={busy||!dirty} onClick={()=>void execute("meeting.save")}>저장</button>}{canEdit&&m.status==="planned"&&<button disabled={busy} onClick={()=>m.starts_at&&Date.parse(m.starts_at)>Date.now()?setDialog("start"):void execute("meeting.start")}>회의 시작</button>}{canEdit&&m.status==="active"&&<button disabled={busy} onClick={()=>void execute("meeting.finish")}>회의 종료 · 검수로</button>}{m.status==="review"&&owner&&<button className="kw-primary" disabled={busy||items.some(i=>i.state==="pending")} onClick={()=>void execute("meeting.review")}>검수 완료</button>}{m.status==="done"&&owner&&<button onClick={()=>setDialog("correct")}>정정 기록 추가</button>}</Header>
    {error&&<p role="alert" className="kw-conflict">{error}</p>}<div className="kw-meeting-layout"><main className="kw-stack"><Card title="안건">{canEdit?<><label>회의 제목<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={240}/></label><label>회의 예정 시각 (한국 시간)<input type="datetime-local" value={startsAt} onChange={e=>setStartsAt(e.target.value)}/></label><textarea aria-label="안건" rows={7} value={agenda} onChange={e=>setAgenda(e.target.value)}/></>:<MarkdownView content={agenda} onOpenLink={openLink}/>}</Card><Card title="회의 메모">{canEdit?<textarea aria-label="회의 메모" rows={16} maxLength={20000} value={content} onChange={e=>setContent(e.target.value)}/>:<MarkdownView content={content} onOpenLink={openLink}/>}<small>{dirty?"저장하지 않은 변경이 있습니다":"저장됨"}</small>{canEdit&&<div className="kw-actions"><button disabled={busy||!content.trim()} onClick={()=>void summarize()}>AI 요약·추출</button><small>비어 있는 메모는 전송하지 않습니다</small></div>}</Card>{summary&&<Card title="요약 초안 · 원문 보존"><p style={{whiteSpace:"pre-wrap"}}>{summary}</p></Card>}{Boolean(m.metadata.corrections?.length)&&<Card title="정정 이력">{(m.metadata.corrections??[]).map((c,i)=><section className="kw-card" key={i}><p>{c.text}</p><small>{c.reason} · {kstTime(c.at)}</small></section>)}</Card>}</main>
    <aside className="kw-stack">{canEdit&&<MeetingCapture append={text=>{if(content.length+text.length+2>20000){setError("회의 메모는 20,000자 이하로 나누어 저장해 주세요.");return false;}setContent(value=>[value,text].filter(Boolean).join("\n\n"));return true;}}/>}<Card title="참석자"><p>{m.attendees.map(id=>state.people.find(p=>p.id===id)?.display_name??"구성원").join(", ")}</p>{owner&&m.status!=="done"&&<button onClick={()=>setDialog("attendees")}>참석자·공개 범위</button>}</Card><Card title="결정과 할 일"><small>AI 초안과 직접 입력 모두 검수 후 확정됩니다.</small>{items.map(item=><section className="kw-card kw-stack" key={item.id}><small>{item.kind==="decision"?"결정":"할 일"}</small><p>{item.text}</p>{item.kind==="task"&&canEdit&&<><label>담당<select value={item.ownerId??""} onChange={e=>setItems(items.map(i=>i.id===item.id?{...i,ownerId:e.target.value}:i))}><option value="">미정</option>{state.people.filter(p=>m.attendees.includes(p.id)).map(p=><option value={p.id} key={p.id}>{p.display_name}</option>)}</select></label><label>기한<input type="date" value={item.dueOn??""} onChange={e=>setItems(items.map(i=>i.id===item.id?{...i,dueOn:e.target.value}:i))}/></label></>}{canEdit?<div className="kw-actions">{[["pending","미검수"],["accepted","채택"],["discarded","제외"]].map(([status,label])=><button key={status} aria-pressed={item.state===status} onClick={()=>setItems(items.map(i=>i.id===item.id?{...i,state:status as MeetingItem["state"]}:i))}>{label}</button>)}</div>:<small>{item.state==="accepted"?"확정":item.state==="discarded"?"제외":"미검수"}</small>}</section>)}{canEdit&&<div className="kw-stack"><select aria-label="추가 항목 종류" value={kind} onChange={e=>setKind(e.target.value as typeof kind)}><option value="decision">결정</option><option value="task">할 일</option></select><textarea aria-label="결정·할 일 내용" value={itemText} onChange={e=>setItemText(e.target.value)}/><button disabled={!itemText.trim()} onClick={addItem}>항목 추가</button></div>}{!items.length&&!canEdit&&<Empty>확정된 항목이 없습니다</Empty>}</Card></aside></div>
    {dialog&&<Modal title={dialog==="start"?"지금 회의를 시작할까요?":dialog==="correct"?"정정 기록":"참석자·공개 범위"} onClose={()=>setDialog(null)} busy={busy}><div className="kw-modal-body">{dialog==="start"?<><p>예정 시각보다 이릅니다. 시작 시각을 지금으로 변경합니다.</p><button className="kw-primary" disabled={busy} onClick={()=>void execute("meeting.start")}>지금 시작</button></>:dialog==="correct"?<><label>정정 내용<textarea value={correction} onChange={e=>setCorrection(e.target.value)}/></label><label>정정 사유<input value={reason} onChange={e=>setReason(e.target.value)}/></label><p>기존 확정 기록은 덮어쓰지 않고 정정 이력을 추가합니다.</p><button className="kw-primary" disabled={busy||!correction.trim()||!reason.trim()} onClick={()=>void execute("meeting.correct",{content:correction,reason})}>정정 저장</button></>:<><label>공개 범위<select value={visibility} onChange={e=>setVisibility(e.target.value as typeof visibility)}><option value="team" disabled={actor.memberKind==="partner"}>팀 공개</option><option value="attendees">참석자만</option></select></label>{state.people.map(p=><label className="kw-actions" key={p.id}><input type="checkbox" disabled={p.id===m.owner_id} checked={attendees.includes(p.id)} onChange={e=>setAttendees(e.target.checked?[...attendees,p.id]:attendees.filter(id=>id!==p.id))}/>{p.display_name}</label>)}<button className="kw-primary" disabled={busy} onClick={()=>void execute("meeting.save",{attendees,visibility})}>저장</button></>}{error&&<p className="kw-error" role="alert">{error}</p>}</div></Modal>}</>;
}
export function KnowledgeDecisions(){
  const {state}=useKnowledge(),params=useSearchParams(),router=useRouter();
  const [q,setQ]=useState(""),[limit,setLimit]=useState(100),filter=params.get("f")??"all";
  const all=state.meetings.slice().sort((a,b)=>(b.starts_at??b.updated_at).localeCompare(a.starts_at??a.updated_at)).flatMap(meeting=>meeting.metadata.items.filter(item=>item.kind==="decision"&&item.state!=="discarded").map(item=>({meeting,item,confirmed:meeting.status==="done"&&item.state==="accepted"})));
  const counts={all:all.length,ok:all.filter(row=>row.confirmed).length,wait:all.filter(row=>!row.confirmed).length};
  const rows=all.filter(row=>(filter==="all"||(filter==="ok"?row.confirmed:!row.confirmed))&&(row.item.text+" "+row.meeting.title).toLowerCase().includes(q.toLowerCase()));
  const person=(id?:string)=>state.people.find(p=>p.id===id)?.display_name??"기록 없음";
  return <><Header title="결정 모음" description="회의에서 나온 결정·확정한 사람·출처를 확인합니다. 변경은 회의록에서 정정으로 남깁니다."/>
    <div className="kw-toolbar"><input aria-label="결정 검색" placeholder="결정·회의 검색" value={q} onChange={e=>{setQ(e.target.value);setLimit(100);}}/>
      {([["all","전체"],["ok","확정"],["wait","확정 전"]] as const).map(([key,label])=><button key={key} aria-pressed={filter===key} onClick={()=>{router.replace("/knowledge/decisions?f="+key);setLimit(100);}}>{label} {counts[key]}</button>)}
    </div><div className="kw-table-wrap"><table className="kw-table"><thead><tr><th>결정</th><th>회의</th><th>정한 사람</th><th>확정</th><th>출처</th></tr></thead>
      <tbody>{rows.slice(0,limit).map(({meeting:m,item:i,confirmed})=><tr key={m.id+i.id}>
        <td style={{whiteSpace:"normal",minWidth:220,maxWidth:440}}><h3>{i.text}</h3></td>
        <td><Link href={"/knowledge/meetings/"+m.id}>{m.title}</Link></td><td>{person(i.addedBy)}</td>
        <td>{confirmed?<>{person(m.metadata.reviewedBy)}<br/><small>{m.metadata.reviewedAt?kstTime(m.metadata.reviewedAt):"시각 기록 없음"}</small></>:<span className="kw-badge">확정 전</span>}</td>
        <td>{i.source==="ai"?"AI 제안 · 사람 검수":i.source==="manual"?"회의 중 기록":"출처 기록 없음"}</td>
      </tr>)}</tbody></table>{!rows.length&&<Empty>결정이 없습니다</Empty>}</div>
    {rows.length>limit&&<button onClick={()=>setLimit(limit+100)}>더 보기</button>}
  </>;
}
