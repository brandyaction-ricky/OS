"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import {Modal} from "./ui";
import {useKnowledge} from "./provider";

/** An administrator must supply an exact URL; never list private notes. */
export function NoteAuditAccess(){
  const {actor,demo,command}=useKnowledge(),router=useRouter();
  const [open,setOpen]=useState(false),[target,setTarget]=useState(""),[reason,setReason]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  if(actor.role!=="admin")return null;
  async function submit(){
    const id=target.trim().match(/(?:^|\/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[?#].*)?$/i)?.[1];
    if(!id){setError("열람할 노트의 정확한 문서 주소를 입력해 주세요.");return;}
    if(demo){setError("로컬 데모에서는 다른 사람의 노트를 열거나 열람 알림을 보내지 않습니다.");return;}
    setBusy(true);setError("");
    try{await command({action:"note.access",id,reason});setOpen(false);router.push(`/knowledge/doc/${id}`);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <><button onClick={()=>setOpen(true)}>감사·인계 목적 임시 열람</button>{open&&<Modal title="내 노트 임시 열람" busy={busy} onClose={()=>setOpen(false)}><form onSubmit={e=>{e.preventDefault();void submit();}}>
    <p>사유를 기록하고 소유자에게 알린 뒤 24시간 동안 읽기만 허용합니다. 비공개 노트 목록은 제공하지 않습니다.</p>
    <label>정확한 문서 주소 또는 ID<input required value={target} onChange={e=>setTarget(e.target.value)}/></label>
    <label>감사·인계 사유<textarea required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    {error&&<p role="alert" className="kw-error">{error}</p>}<footer><button type="button" onClick={()=>setOpen(false)}>취소</button><button className="kw-primary" disabled={busy||!reason.trim()}>기록하고 24시간 열람</button></footer>
  </form></Modal>}</>;
}
