"use client";
import { useEffect, useState } from "react";
import type { Proposal } from "@/lib/knowledge/model";
import { apiRequest } from "@/lib/api-client";
import { kstTime } from "@/lib/knowledge/model";
import { useKnowledge } from "./provider";
type Comment = {id:string;line_no:number;body:string;created_at:string};
export function ProposalComments({proposal:p,line}:{proposal:Proposal;line:number|null}) {
 const {demo,token,command}=useKnowledge();
 const [comments,setComments]=useState<Comment[]>([]),[body,setBody]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 useEffect(()=>{let live=true;if(demo)setComments(p.comments??[]);else void apiRequest<{comments:Comment[]}>(`/api/v1/documents/proposals?id=${p.id}`,{token}).then(r=>{if(live)setComments(r.comments);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[p.id,p.comments,demo,token]);
 async function save(){if(!line||!body.trim())return;setBusy(true);setError("");try{
  if(demo)await command({action:"proposal.comment",id:p.id,lineNo:line,body});
  else{const r=await apiRequest<{comment:Comment}>("/api/v1/documents/proposals",{token,method:"POST",body:JSON.stringify({action:"comment",proposalId:p.id,lineNo:line,body})});setComments([...comments,r.comment]);}
  setBody("");
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="kw-card kw-stack"><h3>줄 댓글</h3><small>삭제된 줄에는 댓글을 달 수 없습니다. 제안 본문 옆 댓글 버튼으로 줄을 선택하세요.</small>
 {comments.map(c=><article key={c.id}><strong>{c.line_no}행</strong><p>{c.body}</p><small>{kstTime(c.created_at)}{c.created_at<(p.updated_at??p.created_at)?" · 이전 제안에 남긴 댓글":""}</small></article>)}
 {p.status==="open"&&<><label>{line?`${line}행에 댓글`:"댓글을 달 줄 선택"}<textarea disabled={!line} maxLength={2000} value={body} onChange={e=>setBody(e.target.value)}/></label><button disabled={busy||!line||!body.trim()} onClick={()=>void save()}>댓글 저장</button></>}{error&&<p role="alert" className="kw-error">{error}</p>}</section>;
}
