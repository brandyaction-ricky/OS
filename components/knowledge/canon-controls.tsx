"use client";
import {useEffect, useState} from "react";
import {useRouter} from "next/navigation";
import type {KnowledgeDocument} from "@/lib/types";
import {getDocumentReaders, listMembers, setDocumentReaders, type OsMember} from "@/lib/api-client";
import {useKnowledge} from "./provider";
import {Modal} from "./ui";

/** Admin-only: limit this canonical document to named members (admins, owner and steward always read it). */
function ReaderScopeDialog({document:doc,close}:{document:KnowledgeDocument;close:()=>void}) {
  const {token,notify,refresh}=useKnowledge();
  const [scope,setScope]=useState<"all"|"restricted"|null>(null),[readers,setReaders]=useState<Set<string>>(new Set()),[version,setVersion]=useState(doc.current_version);
  const [members,setMembers]=useState<OsMember[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{let active=true;void Promise.all([getDocumentReaders(token,doc.id),listMembers(token)]).then(([current,list])=>{if(!active)return;setScope(current.scope);setReaders(new Set(current.readerIds));setVersion(current.currentVersion);setMembers(list.members.filter(member=>member.is_active!==false));}).catch(e=>{if(active)setError((e as Error).message);});return()=>{active=false;};},[token,doc.id]);
  const toggle=(id:string)=>setReaders(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});
  async function save(){if(!scope)return;setBusy(true);setError("");try{
    await setDocumentReaders(token,{documentId:doc.id,expectedVersion:version,scope,readerIds:scope==="restricted"?[...readers]:[]});
    notify(scope==="all"?"전 직원이 볼 수 있게 했습니다":`지정한 직원 ${readers.size}명과 관리자·담당자만 볼 수 있게 했습니다`);
    await refresh();close();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <Modal title="정본 열람 범위" busy={busy} onClose={close}><div className="kw-modal-body">
    {scope===null&&!error?<p>불러오는 중…</p>:<>
      <label><input type="radio" name="reader-scope" checked={scope==="all"} onChange={()=>setScope("all")}/>전 직원이 볼 수 있음</label>
      <label><input type="radio" name="reader-scope" checked={scope==="restricted"} onChange={()=>setScope("restricted")}/>지정한 직원만 볼 수 있음</label>
      {scope==="restricted"&&<><small>관리자와 이 정본의 담당자는 항상 볼 수 있습니다. 검색·AI 키·텔레그램에서도 같은 범위가 적용됩니다.</small>
        <div className="kw-stack">{members.map(member=><label key={member.id}><input type="checkbox" checked={readers.has(member.id)} onChange={()=>toggle(member.id)}/>{member.display_name}{member.role==="admin"?" (관리자)":""}{member.id===doc.steward_id?" (담당자)":""}</label>)}</div></>}
    </>}
    {error&&<p className="kw-error" role="alert">{error}</p>}
    <footer><button disabled={busy} onClick={close}>취소</button><button className="kw-primary" disabled={busy||!scope} onClick={()=>void save()}>반영</button></footer>
  </div></Modal>;
}

export function CanonControls({document: doc}:{document:KnowledgeDocument}) {
  const {actor,state,command,notify}=useKnowledge(),router=useRouter();
  const [mode,setMode]=useState<"steward"|"demote"|null>(null),[readersOpen,setReadersOpen]=useState(false);
  const [steward,setSteward]=useState(doc.steward_id??""),[reason,setReason]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  if(actor.memberKind==="partner")return null;
  async function submit(){setBusy(true);setError("");try{
    await command({action:mode==="steward"?"canon.steward":"canon.demote",id:doc.id,expectedVersion:doc.current_version,stewardId:steward,reason});
    notify(mode==="steward"?"정본 담당자를 변경했습니다":"팀 문서로 내렸습니다. 버전과 보존 기록은 유지됩니다.");
    setMode(null);if(mode==="demote")router.push(`/knowledge/doc/${doc.id}`);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <><div className="kw-actions">
    {doc.reader_scope==="restricted"&&<small role="status">열람 제한 정본</small>}
    {actor.role==="admin"&&<button onClick={()=>setMode("steward")}>담당자 지정</button>}
    {actor.role==="admin"&&<button onClick={()=>setReadersOpen(true)}>열람 범위</button>}
    {(actor.role==="admin"||doc.steward_id===actor.ownerId)&&<button onClick={()=>setMode("demote")}>팀 문서로 내리기</button>}
  </div>{mode&&<Modal title={mode==="steward"?"정본 담당자 지정":"팀 문서로 내리기"} busy={busy} onClose={()=>setMode(null)}><div className="kw-modal-body">
    {mode==="steward"?<label>담당자<select value={steward} onChange={e=>setSteward(e.target.value)}><option value="">활성 구성원 선택</option>{state.people.map(p=><option value={p.id} key={p.id}>{p.display_name}</option>)}</select></label>:<><p>정본 지위를 해제하고 팀이 함께 수정하는 문서로 바꿉니다. 기존 버전·승인 이력은 삭제되지 않습니다.</p><label>변경 사유 (필수)<textarea value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/></label></>}
    {error&&<p className="kw-error" role="alert">{error}</p>}<footer><button disabled={busy} onClick={()=>setMode(null)}>취소</button><button className="kw-primary" disabled={busy||(mode==="steward"?!steward:!reason.trim())} onClick={()=>void submit()}>반영</button></footer>
  </div></Modal>}{readersOpen&&<ReaderScopeDialog document={doc} close={()=>setReadersOpen(false)}/>}</>;
}
