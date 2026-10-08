"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import type {KnowledgeDocument} from "@/lib/types";
import {useKnowledge} from "./provider";
import {Modal} from "./ui";

export function CanonControls({document: doc}:{document:KnowledgeDocument}) {
  const {actor,state,command,notify}=useKnowledge(),router=useRouter();
  const [mode,setMode]=useState<"steward"|"demote"|null>(null);
  const [steward,setSteward]=useState(doc.steward_id??""),[reason,setReason]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  if(actor.memberKind==="partner")return null;
  async function submit(){setBusy(true);setError("");try{
    await command({action:mode==="steward"?"canon.steward":"canon.demote",id:doc.id,expectedVersion:doc.current_version,stewardId:steward,reason});
    notify(mode==="steward"?"정본 담당자를 변경했습니다":"팀 문서로 내렸습니다. 버전과 보존 기록은 유지됩니다.");
    setMode(null);if(mode==="demote")router.push(`/knowledge/doc/${doc.id}`);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <><div className="kw-actions">
    {actor.role==="admin"&&<button onClick={()=>setMode("steward")}>담당자 지정</button>}
    {(actor.role==="admin"||doc.steward_id===actor.ownerId)&&<button onClick={()=>setMode("demote")}>팀 문서로 내리기</button>}
  </div>{mode&&<Modal title={mode==="steward"?"정본 담당자 지정":"팀 문서로 내리기"} busy={busy} onClose={()=>setMode(null)}><div className="kw-modal-body">
    {mode==="steward"?<label>담당자<select value={steward} onChange={e=>setSteward(e.target.value)}><option value="">활성 구성원 선택</option>{state.people.map(p=><option value={p.id} key={p.id}>{p.display_name}</option>)}</select></label>:<><p>정본 지위를 해제하고 팀이 함께 수정하는 문서로 바꿉니다. 기존 버전·승인 이력은 삭제되지 않습니다.</p><label>변경 사유 (필수)<textarea value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/></label></>}
    {error&&<p className="kw-error" role="alert">{error}</p>}<footer><button disabled={busy} onClick={()=>setMode(null)}>취소</button><button className="kw-primary" disabled={busy||(mode==="steward"?!steward:!reason.trim())} onClick={()=>void submit()}>반영</button></footer>
  </div></Modal>}</>;
}
