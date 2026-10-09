"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { documentHref } from "@/lib/knowledge/model";
import { Modal, SpaceBadge } from "./ui";
import { useKnowledge } from "./provider";

/** Mounted only inside the company-document boundary; global menus keep their existing shortcuts. */
export function KnowledgeShortcuts() {
  const {state,actor,command,notify}=useKnowledge(),router=useRouter();
  const [open,setOpen]=useState<"memo"|"search"|null>(null),[body,setBody]=useState(""),[target,setTarget]=useState("inbox");
  const [q,setQ]=useState(""),[debounced,setDebounced]=useState(""),[composing,setComposing]=useState(false),[recent,setRecent]=useState<string[]>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.isComposing)return;const name=e.key.toLowerCase();if(((e.metaKey||e.ctrlKey)&&["j","k"].includes(name))||(e.altKey&&name==="j")){e.preventDefault();e.stopImmediatePropagation();setOpen(name==="j"?"memo":"search");}};document.addEventListener("keydown",key,true);return()=>document.removeEventListener("keydown",key,true);},[]);
  useEffect(()=>{if(composing)return;const timer=setTimeout(()=>setDebounced(q),350);return()=>clearTimeout(timer);},[q,composing]);
  useEffect(()=>{if(open!=="search")return;try{setRecent(JSON.parse(localStorage.getItem(`kw:recent:${actor.ownerId}`)??"[]"));}catch{setRecent([]);}},[open,actor.ownerId]);
  const docs=state.documents.filter(d=>d.status!=="archived"&&d.source!=="mcp");
  const rows=debounced?docs.filter(d=>d.title.toLowerCase().includes(debounced.toLowerCase())).slice(0,6):recent.map(id=>docs.find(d=>d.id===id)).filter(d=>!!d).slice(0,4);
  const meetings=state.meetings.filter(m=>m.status==="active"&&m.attendees.includes(actor.ownerId));
  async function save(){if(!body.trim())return;setBusy(true);setError("");try{await command({action:"note.capture",body,target,meetingId:target.startsWith("meeting:")?target.slice(8):undefined});setBody("");setOpen(null);notify(target==="inbox"?"인박스에 저장했습니다":target==="today"?"오늘 노트에 추가했습니다":"회의 메모에 추가했습니다");}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <><div className="kw-shortcuts"><button onClick={()=>setOpen("search")}>문서 찾기 <kbd>⌘K</kbd></button><button onClick={()=>setOpen("memo")}>빠른 메모 <kbd>⌘J</kbd></button></div>
    {open&&<Modal title={open==="memo"?"빠른 메모":"회사 문서 찾기"} onClose={()=>setOpen(null)} busy={busy}>
      {open==="memo"?<form onSubmit={e=>{e.preventDefault();void save();}}><label>저장할 곳<select value={target} onChange={e=>setTarget(e.target.value)}><option value="inbox">인박스 · 나만 봅니다</option><option value="today">오늘 노트 · 나만 봅니다</option>{meetings.map(m=><option key={m.id} value={`meeting:${m.id}`}>{m.title} · {m.metadata.visibility==="attendees"?"참석자만":"팀 공개"}</option>)}</select></label><label>메모<textarea autoFocus required maxLength={500} rows={6} value={body} onChange={e=>setBody(e.target.value)}/></label><small>{body.length}/500 · Alt+J도 사용할 수 있습니다</small>{error&&<p role="alert" className="kw-error">{error}</p>}<footer><button type="button" onClick={()=>setOpen(null)}>취소</button><button className="kw-primary" disabled={busy||!body.trim()}>메모 저장</button></footer></form>
      :<div className="kw-modal-body"><input autoFocus aria-label="문서 제목 빠른 검색" placeholder="문서 제목 입력" value={q} onChange={e=>setQ(e.target.value)} onCompositionStart={()=>setComposing(true)} onCompositionEnd={()=>setComposing(false)}/><small>{debounced?"제목 검색 · 최대 6개":"최근 문서"}</small>{rows.map(d=><button key={d.id} onClick={()=>{setOpen(null);router.push(documentHref(d));}}>{d.title}<SpaceBadge space={d.status==="draft"?"mine":d.status==="canonical"?"canon":"team"}/></button>)}<button onClick={()=>{setOpen(null);router.push(`/knowledge/search?q=${encodeURIComponent(q)}`);}}>본문·결정까지 검색</button><button onClick={()=>setOpen("memo")}>빠른 메모 작성</button></div>}
    </Modal>}
  </>;
}
