"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter,useSearchParams } from "next/navigation";
import { useEffect,useRef,useState } from "react";
import {TagPicker} from "./tag-picker";
import { Header,Card,Empty,Modal } from "./ui";
import { useKnowledge } from "./provider";
import { documentHref,kstDay,kstTime,type Candidate,type Proposal } from "@/lib/knowledge/model";
import { ProposalComments } from "./proposal-comments";
import { diffMarkdownLines } from "@/lib/line-diff";
import { mergeMarkdown,mergeValue,joinMergeParts } from "@/lib/knowledge/merge";
import { approverChoices, canDecideProposal } from "@/lib/knowledge/access";
import type { KnowledgeDocument,DocumentVersion } from "@/lib/types";
import { apiRequest } from "@/lib/api-client";
import type { CanonListDocument } from "@/lib/knowledge/canon-list";
import { ENTRY_DOCUMENT, ISSUE_LABELS, REGISTRY_DOCUMENTS, ROLE_GROUPS, ROUTING_DOCUMENT, roleGroup } from "@/lib/knowledge/registry";

const KnowledgeDocumentPage=dynamic(()=>import("./editor").then(module=>module.KnowledgeDocumentPage),{loading:()=> <Empty>문서를 불러오는 중…</Empty>});
const MarkdownView=dynamic(()=>import("@/components/knowledge-workspace").then(module=>module.MarkdownView),{loading:()=> <p>내용을 불러오는 중…</p>});
const KnowledgeRichEditor=dynamic(()=>import("@/components/knowledge-rich-editor").then(module=>module.KnowledgeRichEditor),{loading:()=> <Empty>편집기를 불러오는 중…</Empty>});

/** 회사 정본 (대표 2026-11-28): standards people work by, in three layers from the 업무 표; reference originals live in 자료실. */
export function KnowledgeCanon(){
  const {state,canonList,loading,error,command,notify,refresh,actor}=useKnowledge(),params=useSearchParams(),router=useRouter();
  const [searchText,setSearchText]=useState("");
  const [q,setQ]=useState(""),[page,setPage]=useState(0),[busy,setBusy]=useState(false);
  const tab=params.get("tab")==="library"?"library":"canon",folder=params.get("folder")??"",filter=params.get("filter")??"all";
  const everything:CanonListDocument[]=canonList?.documents??state.documents.filter(d=>d.status==="canonical");
  const all=everything.filter(d=>tab==="library"?d.library:!d.library);
  const libraryCount=everything.filter(d=>d.library).length;
  const people=new Map((canonList?.people??state.people).map(person=>[person.id,person.display_name]));
  const roles=canonList?.roles??[];
  const issues=roles.filter(r=>r.issue);
  const admin=(canonList?.actor??actor).role==="admin";
  const byId=new Map(everything.map(d=>[d.id,d]));
  const mapped=new Set([ENTRY_DOCUMENT,ROUTING_DOCUMENT,...REGISTRY_DOCUMENTS,...roles.map(r=>r.id)]);
  const proposals=new Set(canonList?.proposalDocumentIds??state.proposals.filter(p=>p.status==="open").map(p=>p.document_id));
  const today=kstDay();
  const overdue=(d:CanonListDocument)=>Boolean(d.review_due_on&&d.review_due_on<today);
  const folderCounts=new Map<string,number>();
  for(const document of all)folderCounts.set(document.folder,(folderCounts.get(document.folder)??0)+1);
  const filtered=all.filter(d=>(!folder||d.folder===folder||d.folder.startsWith(folder+"/"))&&d.title.toLowerCase().includes(q.toLowerCase())&&(filter==="all"||filter==="overdue"&&overdue(d)||filter==="nosteward"&&!d.steward_id||filter==="proposal"&&proposals.has(d.id)||filter==="unmapped"&&!mapped.has(d.id))).sort((a,b)=>b.updated_at.localeCompare(a.updated_at));
  const layered=tab==="canon"&&!q&&!folder&&filter==="all"&&roles.length>0;   // without the 업무 표 (it could not be read) the flat list shows
  function query(patch:Record<string,string>){const next=new URLSearchParams(params);Object.entries(patch).forEach(([k,v])=>v?next.set(k,v):next.delete(k));setPage(0);router.replace(`/knowledge/canon?${next}`);}
  async function move(ids:string[],on:boolean){if(!ids.length)return;setBusy(true);try{await command({action:"canon.library",ids,on});notify(on?"자료실로 옮겼습니다. 문서 주소와 내용은 그대로예요.":"회사 정본으로 되돌렸습니다.");await refresh();}catch(e){notify((e as Error).message);}finally{setBusy(false);}}
  if(loading)return <Empty>정본 목록을 불러오는 중입니다</Empty>;
  if(error)return <Empty>정본 목록을 확인하지 못했습니다. 위의 다시 불러오기를 눌러 주세요.</Empty>;
  const roleDocs=(group:string)=>{const seen=new Set<string>();return roles.filter(r=>roleGroup(r.key)===group&&!r.issue&&byId.has(r.id)&&!seen.has(r.id)&&seen.add(r.id));};
  const osRules=all.filter(d=>!mapped.has(d.id)&&d.folder.startsWith("00_Skills"));
  const unmapped=all.filter(d=>!mapped.has(d.id)&&!d.folder.startsWith("00_Skills")).sort((a,b)=>a.folder.localeCompare(b.folder,"ko")||a.title.localeCompare(b.title,"ko"));
  const docLink=(id:string,label?:string)=>{const d=byId.get(id);return d?<Link href={`/knowledge/canon/${d.id}`}>{label??d.title}</Link>:<span>{label??"볼 수 없는 문서"}</span>;};
  return <>
    <Header title="회사 정본" description={tab==="library"?"근거·참고 원문이에요. 지우지 않고 주소와 내용 그대로 두며, 검색과 AI 참조도 그대로 돼요.":"일할 때 따르는 회사 기준이에요. 고칠 점은 변경 제안으로 보내면 승인 뒤 새 버전이 돼요."}><Link href="/knowledge/review?tab=todo">정본 검토</Link></Header>
    <nav className="kw-tabs"><Link aria-current={tab==="canon"?"page":undefined} href="/knowledge/canon">정본<span className="kw-count kw-count-quiet">{everything.length-libraryCount}</span></Link><Link aria-current={tab==="library"?"page":undefined} href="/knowledge/canon?tab=library">자료실<span className="kw-count kw-count-quiet">{libraryCount}</span></Link></nav>
    {tab==="canon"&&issues.length>0&&<details className="kw-conflict kw-registry-warn"><summary>업무 표가 정본이 아닌 문서 {issues.length}곳을 가리키고 있어요 — AI와 직원이 이 기준을 열지 못하거나 확정되지 않은 내용을 따를 수 있어요</summary><ul>{issues.map(r=><li key={r.key}><strong>{r.scope||r.key}</strong><span className="kw-review-badge kw-tone-warn">{ISSUE_LABELS[r.issue as keyof typeof ISSUE_LABELS]??r.issue}</span>{r.title&&<Link href={`/knowledge/doc/${r.id}`}>{r.title}</Link>}</li>)}</ul><p>정본으로 올리거나(문서에서 「정본으로 요청하기」), 업무 표에서 빼면 경고가 사라져요.</p></details>}
    {tab==="canon"&&<div className="kw-metrics">{[["all","전체 정본",all.length],["unmapped","업무 표에 없음",all.filter(d=>!mapped.has(d.id)).length],["nosteward","담당자 미지정",all.filter(d=>!d.steward_id).length],["proposal","변경 제안 대기",all.filter(d=>proposals.has(d.id)).length]].map(([key,label,count])=><button className="kw-card" key={key} aria-pressed={filter===key} onClick={()=>query({filter:String(key)})}><span>{label}<strong>{count}</strong></span></button>)}</div>}
    <div className="kw-toolbar"><form className="kw-canon-search" role="search" onSubmit={event=>{event.preventDefault();setQ(searchText.trim());setPage(0);}}><input aria-label="정본 검색" placeholder={tab==="library"?"자료 제목 검색":"정본 제목 검색"} value={searchText} onChange={event=>setSearchText(event.target.value)}/><button type="submit">검색</button></form>{(q||folder||filter!=="all")&&<button onClick={()=>{setSearchText("");setQ("");query({folder:"",filter:""});}}>처음 화면으로</button>}<small>{layered?`${all.length}개`:`${filtered.length}개`}</small></div>
    {layered?<div className="kw-layers">
      <section className="kw-layer"><header><span className="kw-layer-no">1층</span><h2>진입</h2><small>모든 AI·직원이 가장 먼저 여는 운영 정본</small></header><div className="kw-layer-docs">{docLink(ENTRY_DOCUMENT)}</div></section>
      <section className="kw-layer"><header><span className="kw-layer-no">2층</span><h2>업무 표</h2><small>어떤 일에 어떤 정본을 쓰는지 정하는 표</small></header><div className="kw-layer-docs">{[ROUTING_DOCUMENT,...REGISTRY_DOCUMENTS].map(id=><span key={id}>{docLink(id)}</span>)}</div></section>
      <section className="kw-layer"><header><span className="kw-layer-no">3층</span><h2>업무별 담당 정본</h2><small>업무 표가 가리키는 기준</small></header>
        <div className="kw-layer-groups">{ROLE_GROUPS.map(([group])=>{const docs=roleDocs(group);return docs.length?<div className="kw-layer-group" key={group}><h3>{group}<span>{docs.length}</span></h3><ul>{docs.map(r=><li key={r.id}>{docLink(r.id)}{r.scope&&<small>{r.scope}</small>}</li>)}</ul></div>:null;})}
        {osRules.length>0&&<div className="kw-layer-group"><h3>OS 운영 기준<span>{osRules.length}</span></h3><ul>{osRules.map(d=><li key={d.id}><Link href={`/knowledge/canon/${d.id}`}>{d.title}</Link></li>)}</ul></div>}</div></section>
      {unmapped.length>0&&<section className="kw-layer kw-layer-loose"><header><span className="kw-layer-no">+</span><h2>업무 표에 없는 정본</h2><small>업무 표에 연결하거나, 참고 원문이면 자료실로 옮기세요</small></header><CanonTable rows={unmapped} people={people} proposals={proposals} overdue={overdue} admin={admin} busy={busy} move={move} library={false}/></section>}
    </div>:<div className={tab==="library"?"kw-db":"kw-canon-flat"}>
      {tab==="library"&&<aside className="kw-card kw-categories"><h3>자료 폴더</h3><button aria-pressed={!folder} onClick={()=>query({folder:""})}>전체 폴더</button>{[...folderCounts].sort(([a],[b])=>a.localeCompare(b,"ko")).map(([path,count])=><button key={path} title={path||"분류 없음"} aria-pressed={folder===path} onClick={()=>query({folder:path})}><span className="kw-category-name">{path.includes("/")&&<em>{path.slice(0,path.lastIndexOf("/"))}</em>}{path.slice(path.lastIndexOf("/")+1)||"분류 없음"}</span><small>{count}</small></button>)}</aside>}
      <div><CanonTable rows={filtered.slice(page*50,(page+1)*50)} people={people} proposals={proposals} overdue={overdue} admin={admin} busy={busy} move={move} library={tab==="library"}/>
        <div className="kw-toolbar"><button disabled={!page} onClick={()=>setPage(page-1)}>이전</button><small>{page+1} / {Math.max(1,Math.ceil(filtered.length/50))}</small><button disabled={(page+1)*50>=filtered.length} onClick={()=>setPage(page+1)}>다음</button></div></div>
    </div>}
  </>;
}
function CanonTable({rows,people,proposals,overdue,admin,busy,move,library}:{rows:CanonListDocument[];people:Map<string,string>;proposals:Set<string>;overdue:(d:CanonListDocument)=>boolean;admin:boolean;busy:boolean;move:(ids:string[],on:boolean)=>Promise<void>;library:boolean}){
  return <div className="kw-table-wrap"><table className="kw-table"><thead><tr><th>{library?"자료":"정본"}</th>{!library&&<th>담당자</th>}{!library&&<th>검토일</th>}<th>버전</th><th>수정</th>{admin&&<th aria-label="옮기기"/>}</tr></thead><tbody>{rows.map(d=><tr key={d.id}><td><Link href={`/knowledge/canon/${d.id}`}>{d.title}</Link>{proposals.has(d.id)&&<Link className="kw-badge kw-badge-link" href={`/knowledge/review?document=${d.id}`} title="정본 검토에서 승인하기">변경 제안 검토</Link>}<small className="kw-row-folder">{d.folder}</small></td>{!library&&<td>{people.get(d.steward_id??"")??"미지정"}</td>}{!library&&<td className={overdue(d)?"kw-danger":""}>{d.review_due_on??"미지정"}</td>}<td>v{d.current_version}</td><td>{kstTime(d.updated_at).slice(0,10)}</td>{admin&&<td><button className="kw-row-move" disabled={busy} onClick={()=>void move([d.id],!library)}>{library?"정본으로":"자료실로"}</button></td>}</tr>)}</tbody></table>{!rows.length&&<Empty>{library?"조건에 맞는 자료가 없습니다":"조건에 맞는 정본이 없습니다"}</Empty>}</div>;
}
export function KnowledgeCanonDocument({id}:{id:string}){return <KnowledgeDocumentPage id={id}/>;}
export function KnowledgeProposalPage({id}:{id:string}){
  const {loadDocument,loading,demo,token,state}=useKnowledge(),params=useSearchParams();
  const versionNumber=Number(params.get("version"))||0;
  const [historical,setHistorical]=useState<DocumentVersion|null>(null),[doc,setDoc]=useState<KnowledgeDocument|null>(null),[error,setError]=useState("");
  useEffect(()=>{if(loading)return;let live=true;setDoc(current=>current?.id===id?current:null);setError("");void loadDocument(id).then(async d=>{
    let selected:DocumentVersion|null=null;
    if(versionNumber){const versions=demo?state.versions[id]??[]:(await apiRequest<{versions:DocumentVersion[]}>(`/api/v1/documents/${id}/versions`,{token})).versions;selected=versions.find(v=>v.version_no===versionNumber)??null;if(!selected)throw Error("선택한 과거 버전을 찾을 수 없습니다.");}
    if(live){setHistorical(selected);setDoc(d);}
  }).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[id,loadDocument,loading,versionNumber,demo,token,state.versions]);
  return error?<Empty>{error}</Empty>:!doc?<Empty>정본을 불러오는 중입니다</Empty>:doc.status!=="canonical"?<Empty>회사 정본만 변경 제안을 작성합니다</Empty>:<ProposalEditor key={doc.id+":"+versionNumber} doc={doc} historical={historical}/>;
}
function ProposalEditor({doc,historical}:{doc:KnowledgeDocument;historical:DocumentVersion|null}){
  const {state,actor,command,notify,token}=useKnowledge(),router=useRouter(),params=useSearchParams();
  const prior=state.proposals.find(p=>p.id===params.get("proposal")&&p.author_id===actor.ownerId&&p.status==="returned"&&p.return_kind==="revise");
  const draft=state.drafts.find(d=>d.document_id===doc.id);
  // The form beside the text (reason, approver, …) is kept in this browser until it is sent, so a reload does not empty it.
  const formKey=`canon-proposal-form:${doc.id}`;
  const [kept]=useState<Record<string,string>|null>(()=>{if(prior||historical)return null;try{return JSON.parse(localStorage.getItem(formKey)??"null");}catch{return null;}});
  const [title,setTitle]=useState(historical?.title??prior?.title??draft?.title??doc.title),[content,setContent]=useState(historical?.content_md??prior?.content_md??draft?.content_md??doc.content_md),[folder,setFolder]=useState(prior?.folder??kept?.folder??doc.folder),[tags,setTags]=useState(kept?.tags??(prior?.tags??doc.tags).join(", "));
  const [reason,setReason]=useState(historical?`v${historical.version_no} 내용으로 복원 제안`:prior?.author_note??kept?.reason??""),[approver,setApprover]=useState(prior?.requested_approver_id??kept?.approver??""),[due,setDue]=useState(prior?.review_due_on??kept?.due??doc.review_due_on??""),[ai,setAi]=useState(prior?.ai_assist??kept?.ai??"");
  useEffect(()=>{try{localStorage.setItem(formKey,JSON.stringify({reason,approver,due,folder,tags,ai}));}catch{/* private window: the form is simply not kept */}},[formKey,reason,approver,due,folder,tags,ai]);
  // 정본 변경 제안 (2026-11-12): the editor writes the whole text back in its own style; keep the original wording of every line
  // the person did not touch, so the proposal changes only what they changed.
  const [editorKey,setEditorKey]=useState(0),[raw,setRaw]=useState(false);
  // Open the editor again on `text` (after discarding the draft or leaving the Markdown view): that text becomes the wording to keep.
  const restart=()=>setEditorKey(k=>k+1);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[saved,setSaved]=useState(draft&&!prior&&!historical?`${kstTime(draft.updated_at)} 임시 저장본을 이어서 씁니다`:"");
  const baseVersion=historical?doc.current_version:prior?.base_version??draft?.base_version??doc.current_version;
  const lastSaved=useRef(draft?draft.title+"\n"+draft.content_md:"");
  useEffect(()=>{if(title===doc.title&&content===doc.content_md||title+"\n"+content===lastSaved.current)return;const timer=setTimeout(()=>void command({action:"document.draft",id:doc.id,title,content,expectedVersion:baseVersion}).then(()=>{lastSaved.current=title+"\n"+content;setSaved("제안 본문 임시 저장됨");}).catch(e=>setError(e.message)),1500);return()=>clearTimeout(timer);},[title,content,doc.id,doc.title,doc.content_md,baseVersion,command]);
  async function discard(){if(!window.confirm("임시 저장된 초안을 버리고 현재 정본 원문에서 다시 시작할까요?"))return;setBusy(true);try{await command({action:"document.discard",id:doc.id});lastSaved.current="";setTitle(doc.title);setContent(doc.content_md);restart();setSaved("현재 정본 원문에서 다시 시작합니다");}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function submit(){setBusy(true);try{const result=await command({action:"proposal.create",id:doc.id,proposalId:prior?.id,expectedVersion:baseVersion,title,content,folder,tags:tags.split(",").map(t=>t.trim()).filter(Boolean),reason,approverId:approver,reviewDueOn:due,aiAssist:ai});try{localStorage.removeItem(formKey);}catch{/* nothing kept */}notify("변경 제안을 보냈습니다. 정본은 승인 전까지 그대로 유지됩니다.");router.push("/knowledge/review?tab=sent"+(result.id?"&id="+encodeURIComponent(result.id):""));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <><Header title="정본 변경 제안" description={`원본 v${doc.current_version} · 제안 기준 v${baseVersion} · ${saved||"본문만 임시 저장됩니다"}`}><Link href={`/knowledge/canon/${doc.id}`}>정본으로 돌아가기</Link>{!prior&&!historical&&(draft||title!==doc.title||content!==doc.content_md)&&<button disabled={busy} onClick={()=>void discard()}>초안 버리기</button>}<button className="kw-primary" disabled={busy||!reason.trim()||!approver} onClick={()=>void submit()}>{prior?"수정하여 다시 제출":"변경 제안 보내기"}</button></Header>{baseVersion!==doc.current_version&&<p className="kw-conflict">기준 버전이 오래되었습니다. 제출 후 최신 정본과 충돌을 해결해야 승인할 수 있습니다.</p>}<div className="kw-meeting-layout"><Card title="제안 내용"><input aria-label="제안 제목" value={title} onChange={e=>setTitle(e.target.value)}/><div className="kw-actions"><button onClick={()=>{if(raw)restart();setRaw(!raw);}}>{raw?"편집 화면으로 돌아가기":"마크다운 원문으로 고치기"}</button></div>{raw?<textarea aria-label="제안 본문 마크다운" spellCheck={false} style={{minHeight:480,width:"100%",fontFamily:"ui-monospace,monospace"}} value={content} onChange={e=>setContent(e.target.value)}/>:<KnowledgeRichEditor key={editorKey} markdown={content} accessToken={token} onChange={setContent} onError={setError}/>}</Card><aside className="kw-card kw-stack"><label>변경 이유 (필수 · 200자)<textarea required maxLength={200} value={reason} onChange={e=>setReason(e.target.value)}/></label><label>승인자<select value={approver} onChange={e=>setApprover(e.target.value)}><option value="">승인자 선택</option>{approverChoices(state.people).map(p=><option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label><label>정본 폴더<input value={folder} onChange={e=>setFolder(e.target.value)}/></label><TagPicker value={tags.split(",").map(t=>t.trim()).filter(Boolean)} onChange={values=>setTags(values.join(", "))}/><label>검토일<input type="date" value={due} onChange={e=>setDue(e.target.value)}/></label><label>AI 도움을 받은 부분 (선택)<textarea value={ai} onChange={e=>setAi(e.target.value)}/></label>{error&&<p className="kw-error" role="alert">{error}</p>}</aside></div></>;
}
/** 정본 검토 (대표 2026-11-28): one list of requests, the text right beside it, one button that makes it company canon. */
type ReviewItem={kind:"candidate";id:string;candidate:Candidate;doc?:KnowledgeDocument;at:string;state:"open"|"publish"|"changed"|"done"}|{kind:"proposal";id:string;proposal:Proposal;doc?:KnowledgeDocument;at:string;stale:boolean};
export function KnowledgeReview(){
  const {state,actor}=useKnowledge(),params=useSearchParams();
  const tab=params.get("tab")??"todo";
  const doc=(id:string)=>state.documents.find(d=>d.id===id);
  const mineToDecide=(approver?:string|null)=>approver===actor.ownerId||(!approver&&actor.role==="admin");
  const candidateItem=(c:Candidate):ReviewItem=>{const d=doc(c.document_id);const changed=c.status==="approved"&&d?.status==="reviewed"&&c.approved_version!=null&&c.approved_version!==d.current_version;
    return {kind:"candidate",id:c.id,candidate:c,doc:d,at:c.submitted_at,state:c.status==="open"?"open":changed?"changed":c.status==="approved"&&d?.status==="reviewed"?"publish":"done"};};
  const proposalItem=(p:Proposal):ReviewItem=>{const d=doc(p.document_id);return {kind:"proposal",id:p.id,proposal:p,doc:d,at:p.created_at,stale:p.status==="open"&&Boolean(d)&&p.base_version!==d!.current_version};};
  const candidates=state.candidates.map(candidateItem),proposals=state.proposals.map(proposalItem);
  const lists:Record<string,ReviewItem[]>={
    todo:[...candidates.filter(i=>i.kind==="candidate"&&(i.state==="open"&&mineToDecide(i.candidate.requested_approver_id)||(i.state==="publish"&&actor.canPublishCanonical)||(i.state==="changed"&&(mineToDecide(i.candidate.requested_approver_id)||actor.canPublishCanonical)))),
      ...proposals.filter(i=>i.kind==="proposal"&&i.proposal.status==="open"&&!i.stale&&mineToDecide(i.proposal.requested_approver_id))],
    stale:proposals.filter(i=>i.kind==="proposal"&&i.stale&&(mineToDecide(i.proposal.requested_approver_id)||i.proposal.author_id===actor.ownerId)),
    sent:[...candidates.filter(i=>i.kind==="candidate"&&i.candidate.submitted_by===actor.ownerId),...proposals.filter(i=>i.kind==="proposal"&&i.proposal.author_id===actor.ownerId)],
    done:[...candidates.filter(i=>i.kind==="candidate"&&i.state==="done"&&(i.candidate.decided_by===actor.ownerId||i.candidate.submitted_by===actor.ownerId)),...proposals.filter(i=>i.kind==="proposal"&&i.proposal.status!=="open"&&(i.proposal.author_id===actor.ownerId||i.proposal.reviewer_id===actor.ownerId))],
  };
  for(const list of Object.values(lists))list.sort((a,b)=>b.at.localeCompare(a.at));
  const items=lists[tab]??lists.todo;
  const wanted=params.get("id")??params.get("proposal")??[...state.proposals.filter(p=>p.status==="open"),...state.candidates.filter(c=>c.status!=="withdrawn")].find(x=>x.document_id===params.get("document"))?.id;
  const selected=items.find(i=>i.id===wanted)??[...candidates,...proposals].find(i=>i.id===wanted)??items[0];
  const meetings=state.meetings.filter(m=>m.status==="review"&&(m.owner_id===actor.ownerId||actor.role==="admin")).length;
  return <><Header title="정본 검토" description="요청을 누르면 내용이 바로 보여요. 승인하면 그대로 회사 정본이 돼요.">{meetings>0&&<Link href="/knowledge/meetings">회의 검수 {meetings}건</Link>}</Header>
    <nav className="kw-tabs">{[["todo","검토할 것"],["stale","낡은 제안"],["sent","내가 보낸 것"],["done","끝난 것"]].map(([value,label])=><Link key={value} aria-current={tab===value?"page":undefined} href={`/knowledge/review?tab=${value}`}>{label}{(value==="todo"||value==="stale")&&lists[value].length>0&&<span className="kw-count">{lists[value].length}</span>}</Link>)}</nav>
    <div className="kw-review-layout"><aside className="kw-review-list" aria-label="요청 목록">{items.map(i=><ReviewCard key={i.id} item={i} tab={tab} current={selected?.id===i.id}/>)}{!items.length&&<Empty>{tab==="todo"?"지금 검토할 요청이 없어요":tab==="stale"?"낡은 제안이 없어요":"항목이 없어요"}</Empty>}</aside>
    <main>{selected?selected.kind==="candidate"?<CandidateReview key={selected.id} id={selected.id}/>:<ProposalReview key={selected.id} proposal={selected.proposal}/>:null}</main></div></>;
}
function reviewBadge(item:ReviewItem){
  if(item.kind==="proposal")return item.stale?["낡은 제안","old"]:item.proposal.status==="open"?["정본 변경","change"]:[({approved:"반영됨",withdrawn:"취소됨",rejected:"반려",returned:"보완 요청"} as Record<string,string>)[item.proposal.status]??item.proposal.status,"done"];
  return {open:["새 정본 요청","new"],publish:["등록 대기","new"],changed:["다시 확인","warn"],done:[({approved:"정본 등록",returned:"보완 요청",withdrawn:"취소됨"} as Record<string,string>)[item.candidate.status]??item.candidate.status,"done"]}[item.state];
}
function ReviewCard({item,tab,current}:{item:ReviewItem;tab:string;current:boolean}){
  const {state}=useKnowledge();const [label,tone]=reviewBadge(item);
  const who=state.people.find(p=>p.id===(item.kind==="candidate"?item.candidate.submitted_by:item.proposal.author_id))?.display_name??"";
  const title=item.kind==="candidate"?item.doc?.title??"볼 수 없는 문서":item.proposal.title;
  const why=item.kind==="candidate"?item.candidate.submit_note:item.proposal.author_note;
  return <Link className="kw-review-card" aria-current={current?"page":undefined} href={`/knowledge/review?tab=${tab}&id=${item.id}`}>
    <span className={`kw-review-badge kw-tone-${tone}`}>{label}</span><strong>{title}</strong>
    <small>{who}{who&&" · "}{kstTime(item.at).slice(5,16)}</small>{why&&<em>「{why}」</em>}</Link>;
}
function useFullDocument(id:string){
  const {loadDocument}=useKnowledge();const [doc,setDoc]=useState<KnowledgeDocument|null>(null),[error,setError]=useState("");
  useEffect(()=>{let live=true;setDoc(current=>current?.id===id?current:null);void loadDocument(id).then(d=>{if(live)setDoc(d);}).catch(e=>{if(live)setError((e as Error).message);});return()=>{live=false;};},[id,loadDocument]);
  return {doc,error};
}
function CandidateReview({id}:{id:string}){
  const {state,actor,command,notify,token,demo}=useKnowledge(),router=useRouter();
  const c=state.candidates.find(c=>c.id===id)!,listed=state.documents.find(d=>d.id===c.document_id);
  const {doc:full,error:readError}=useFullDocument(c.document_id);
  const [memo,setMemo]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[approved,setApproved]=useState<DocumentVersion|null>(null);
  const doc=full??listed;
  const name=(who?:string|null)=>state.people.find(p=>p.id===who)?.display_name??"미지정";
  const changed=c.status==="approved"&&doc?.status==="reviewed"&&c.approved_version!=null&&c.approved_version!==doc.current_version;
  // 승인 뒤 바뀐 부분: the version the approver saw, side by side with today's text.
  useEffect(()=>{if(!changed||!doc)return;let live=true;const read=demo?Promise.resolve(state.versions[doc.id]??[]):apiRequest<{versions:DocumentVersion[]}>(`/api/v1/documents/${doc.id}/versions`,{token}).then(r=>r.versions);
    void read.then(v=>{if(live)setApproved(v.find(x=>x.version_no===c.approved_version)??null);}).catch(e=>{if(live)setError((e as Error).message);});return()=>{live=false;};},[changed,doc,c.approved_version,demo,state.versions,token]);
  if(!doc)return <Empty>{readError||"문서를 불러오는 중입니다"}</Empty>;
  const canDecide=canDecideProposal(actor,{requested_approver_id:c.requested_approver_id},memo);
  const publisher=state.people.find(p=>p.publisher)?.display_name??"정본 담당자";
  const oneStep=actor.canPublishCanonical;
  const openLink=(title:string)=>{const target=state.documents.find(d=>d.title===title);if(target)router.push(documentHref(target));};
  async function approve(){setBusy(true);setError("");try{
      await command({action:"candidate.decide",id,expectedVersion:doc!.current_version,decision:"approved",reason:memo.trim()||(changed?"승인 뒤 바뀐 내용까지 확인하고 다시 승인":"")});
      if(oneStep){await command({action:"candidate.publish",id,expectedVersion:doc!.current_version});notify("회사 정본으로 등록했습니다.");}
      else notify(`승인했습니다. ${publisher}님이 정본으로 등록하면 끝나요.`);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function publish(){setBusy(true);setError("");try{await command({action:"candidate.publish",id,expectedVersion:doc!.current_version});notify("회사 정본으로 등록했습니다.");}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function sendBack(){setBusy(true);setError("");try{await command({action:"candidate.decide",id,expectedVersion:doc!.current_version,decision:"returned",reason:memo.trim()});notify("보완 요청을 보냈습니다. 문서는 팀 문서로 돌아가요.");}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const diff=changed&&approved?diffMarkdownLines(approved.content_md,doc.content_md):[];
  return <article className="kw-card kw-review-detail">
    <header><span className={`kw-review-badge kw-tone-${changed?"warn":"new"}`}>{changed?"승인 뒤 내용이 바뀜":c.status==="open"?"새 정본 요청":c.status==="approved"?"승인됨 · 등록 대기":"끝난 요청"}</span><h2>{doc.title}</h2>
      <p className="kw-review-meta">{name(c.submitted_by)} 요청 · {kstTime(c.submitted_at).slice(0,16)} · <Link href={`/knowledge/doc/${doc.id}`}>문서 열기</Link></p></header>
    <div className="kw-review-why"><small>왜 정본으로?</small><p>{c.submit_note||"이유가 적히지 않은 예전 요청이에요."}</p></div>
    <dl className="kw-review-facts"><div><dt>승인</dt><dd>{name(c.requested_approver_id)}</dd></div><div><dt>담당</dt><dd>{name(c.steward_id)}</dd></div><div><dt>검토일</dt><dd>{c.review_due_on}</dd></div><div><dt>폴더</dt><dd>{c.target_folder||"미분류"}</dd></div></dl>
    {changed&&<section className="kw-review-changed"><h3>승인한 v{c.approved_version} 뒤에 바뀐 부분</h3>{approved?<div className="kw-diff" aria-label="승인 뒤 바뀐 부분">{diff.map((line,i)=>(line.kind!=="same"||diff[i-1]?.kind!=="same"||diff[i+1]?.kind!=="same")&&<div className={`kw-diff-${line.kind}`} key={i}><small>{line.oldLine??" "} {line.newLine??" "}</small><span>{line.kind==="added"?"+":line.kind==="removed"?"−":" "}</span><code>{line.text||" "}</code></div>)}</div>:<p>{error||"비교 내용을 불러오는 중입니다"}</p>}</section>}
    <section className="kw-review-body" aria-label="문서 내용"><h3>{changed?"지금 내용 전체":"내용 전체"}</h3>{full?<MarkdownView content={full.content_md} onOpenLink={openLink}/>:<p>{readError||"내용을 불러오는 중입니다"}</p>}</section>
    {c.decision_note&&c.status!=="open"&&<p className="kw-review-meta">검토 메모 · {name(c.decided_by)}: {c.decision_note}</p>}
    {(c.status==="open"||changed||(c.status==="approved"&&doc.status==="reviewed"))&&<footer className="kw-decide">
      {c.status==="open"&&<ol className="kw-decide-steps"><li>① 검토 승인 · {name(c.requested_approver_id)}</li><li>② 정본 등록 · {oneStep?"한 번에":publisher}</li></ol>}
      {c.status==="open"&&<textarea aria-label="검토 메모" placeholder={canDecide?"메모 (보완 요청 때는 꼭 적어 주세요)":"대신 처리할 때는 사유를 적어 주세요"} value={memo} maxLength={2000} onChange={e=>setMemo(e.target.value)}/>}
      {error&&<p className="kw-error" role="alert">{error}</p>}
      <div className="kw-actions">
        {c.status==="open"&&<><button disabled={busy||!canDecide||!memo.trim()} onClick={()=>void sendBack()}>보완 요청</button>{c.submitted_by===actor.ownerId&&<button disabled={busy} onClick={()=>void command({action:"candidate.withdraw",id}).catch(e=>setError(e.message))}>요청 취소</button>}<button className="kw-primary" disabled={busy||!canDecide} onClick={()=>void approve()}>{oneStep?"정본으로 승인":"검토 승인"}</button></>}
        {changed&&<button className="kw-primary" disabled={busy||!(canDecideProposal(actor,{requested_approver_id:c.requested_approver_id},"바뀐 내용 확인")||actor.canPublishCanonical)} onClick={()=>void approve()}>바뀐 내용까지 확인 · {oneStep?"정본으로 승인":"다시 승인"}</button>}
        {!changed&&c.status==="approved"&&doc.status==="reviewed"&&<button className="kw-primary" disabled={busy||!actor.canPublishCanonical} onClick={()=>void publish()}>정본으로 등록</button>}
      </div>
      {c.status==="open"&&!canDecide&&<small>지정된 승인자가 처리해요. 관리자는 사유를 적으면 대신 처리할 수 있어요.</small>}
      {!changed&&c.status==="approved"&&doc.status==="reviewed"&&!actor.canPublishCanonical&&<small>{publisher}님이 정본으로 등록해요.</small>}
    </footer>}
  </article>;
}
function ProposalReview({proposal:p}:{proposal:Proposal}){
  const {state,actor,command,loadDocument,notify,token,demo}=useKnowledge();
  const [commentLine,setCommentLine]=useState<number|null>(null);
  const [full,setFull]=useState<KnowledgeDocument|null>(null),[base,setBase]=useState<DocumentVersion|null|undefined>(undefined),[reason,setReason]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[all,setAll]=useState(false),[merge,setMerge]=useState(false);
  // A decided proposal arrives without its text; read it once when it is opened.
  const [body,setBody]=useState<string|null>(p.content_omitted?null:p.content_md);
  useEffect(()=>{if(!p.content_omitted){setBody(p.content_md);return;}let live=true;setBody(null);void apiRequest<{proposals:Proposal[]}>(`/api/v1/documents/proposals?id=${encodeURIComponent(p.id)}`,{token}).then(r=>{if(live)setBody(r.proposals[0]?.content_md??"");}).catch(e=>{if(live)setError((e as Error).message);});return()=>{live=false;};},[p.id,p.content_omitted,p.content_md,token]);
  // The card opens with the listed document; its text and the base version are read side by side (base undefined = still reading).
  useEffect(()=>{let live=true;setBase(undefined);const fail=(e:Error)=>{if(live)setError(e.message);};
    const docRead=loadDocument(p.document_id),versionsRead=demo?Promise.resolve(state.versions[p.document_id]??[]):apiRequest<{versions:DocumentVersion[]}>(`/api/v1/documents/${p.document_id}/versions`,{token}).then(r=>r.versions);
    docRead.then(d=>{if(live)setFull(d);},fail);
    Promise.all([docRead,versionsRead]).then(([d,versions])=>{if(live)setBase(versions.find(v=>v.version_no===p.base_version)??(p.base_version===d.current_version?{...d,version_no:d.current_version,author_id:d.owner_id,author_name:"",reason:""}:null));},fail);
    return()=>{live=false;};},[p.document_id,p.base_version,p.status,loadDocument,token,demo,state.versions]);
  const doc=full??state.documents.find(d=>d.id===p.document_id)??null;
  if(!doc||body===null)return <Empty>{error||"검토 내용을 불러오는 중입니다"}</Empty>;
  const allowed=canDecideProposal(actor,p,reason),outdated=p.base_version!==doc.current_version;
  const diff=base?diffMarkdownLines(base.content_md,body):[];
  async function decide(decision:string,note=reason){setBusy(true);setError("");try{await command({action:"proposal.decide",id:p.id,decision,reason:note});notify(decision==="approved"?"승인했습니다. 정본에 새 버전으로 반영됐어요.":decision==="rejected"&&outdated?"낡은 제안을 닫았습니다.":"검토 결과를 저장했습니다.");}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const who=state.people.find(person=>person.id===p.author_id)?.display_name??"";
  const closeNote="정본이 그사이 바뀌어 낡은 제안으로 닫습니다. 필요하면 최신 정본에서 다시 제안해 주세요.";
  const canClose=canDecideProposal(actor,p,closeNote);
  return <article className="kw-card kw-review-detail"><header><span className={`kw-review-badge kw-tone-${outdated&&p.status==="open"?"old":"change"}`}>{outdated&&p.status==="open"?"낡은 제안":"정본 변경 제안"}</span><h2>{p.title}</h2><p className="kw-review-meta">{who}{who&&" 제안 · "}{kstTime(p.created_at).slice(0,16)} · 기준 v{p.base_version} → 지금 v{doc.current_version} · <Link href={`/knowledge/canon/${doc.id}`}>지금 정본 열기</Link></p></header>
  <div className="kw-review-why"><small>왜 바꾸나요?</small><p>{p.author_note||"이유가 적히지 않았어요."}</p>{p.ai_assist&&<small>AI 도움: {p.ai_assist}</small>}</div>
  {outdated&&p.status==="open"&&<div className="kw-conflict"><p>정본이 그사이 v{p.base_version}에서 v{doc.current_version}로 바뀌어, 이 제안은 그대로 승인할 수 없어요.</p><div className="kw-actions">{base&&(p.author_id===actor.ownerId||allowed)&&<button onClick={()=>setMerge(true)}>최신 정본에 맞춰 고치기</button>}{(canClose||p.author_id===actor.ownerId)&&<button disabled={busy} onClick={()=>void (p.author_id===actor.ownerId?decide("withdrawn",closeNote):decide("rejected",closeNote))}>제안 닫기</button>}</div></div>}{base===undefined?<p>{error||"비교 내용을 불러오는 중입니다"}</p>:!base?<p className="kw-error">기준 버전을 확인하지 못했습니다. 비교 확인 전 승인을 진행할 수 없습니다.</p>:<><div className="kw-actions"><button onClick={()=>setAll(!all)}>{all?"변경 부분만":"전체 내용"}</button><Link href={`/knowledge/canon/${doc.id}`}>현재 정본</Link></div><div className="kw-diff" aria-label="변경 비교">{diff.map((line,i)=>(all||line.kind!=="same"||diff[i-1]?.kind!=="same"||diff[i+1]?.kind!=="same")&&<div className={`kw-diff-${line.kind}`} key={i}><small>{line.oldLine??" "} {line.newLine??" "}</small><span>{line.kind==="added"?"+":line.kind==="removed"?"−":" "}</span><code>{line.text||" "}</code>{line.newLine!==null&&p.status==="open"&&<button aria-label={`${line.newLine}행 댓글`} onClick={()=>setCommentLine(line.newLine)}>댓글</button>}</div>)}</div>{[["제목",base.title,p.title],["폴더",doc.folder,p.folder],["태그",doc.tags.join(", "),p.tags.join(", ")],["검토일",doc.review_due_on??"",p.review_due_on??""]].filter(([,a,b])=>a!==b).map(([label,a,b])=><p key={label}><strong>{label}</strong> <del>{a||"없음"}</del> → {b||"없음"}</p>)}</>}<ProposalComments proposal={p} line={commentLine}/>{p.note&&<p className="kw-review-meta">검토 메모: {p.note}</p>}
  {(p.status==="open"&&!outdated||(p.author_id===actor.ownerId&&p.status==="returned"&&p.return_kind==="revise"))&&<footer className="kw-decide">{p.status==="open"&&<textarea aria-label="검토 메모" placeholder={allowed?"메모 (반려·보완 요청 때는 꼭 적어 주세요)":"대신 처리할 때는 사유를 적어 주세요"} value={reason} onChange={e=>setReason(e.target.value)} maxLength={2000}/>}{error&&<p className="kw-error" role="alert">{error}</p>}<div className="kw-actions">{p.status==="open"&&<><button disabled={busy||!allowed||!reason.trim()} onClick={()=>void decide("rejected")}>반려</button><button disabled={busy||!allowed||!reason.trim()} onClick={()=>void decide("returned")}>보완 요청</button>{p.author_id===actor.ownerId&&<button disabled={busy} onClick={()=>void decide("withdrawn")}>제안 취소</button>}<button className="kw-primary" disabled={busy||!allowed||outdated||!base} onClick={()=>void decide("approved")}>승인하고 정본에 반영</button></>}{p.author_id===actor.ownerId&&p.status==="returned"&&p.return_kind==="revise"&&<Link className="kw-primary" href={`/knowledge/canon/${doc.id}/propose?proposal=${p.id}`}>보완해서 다시 보내기</Link>}</div>{p.status==="open"&&!allowed&&<small>지정된 승인자가 처리해요. 관리자는 사유를 적으면 대신 처리할 수 있어요.</small>}</footer>}
  {error&&!(p.status==="open"&&!outdated)&&<p className="kw-error" role="alert">{error}</p>}{merge&&base&&full&&<MergeDialog proposal={p} current={full} base={base} close={()=>setMerge(false)}/>}</article>;
}
function MergeDialog({proposal:p,current:d,base,close}:{proposal:Proposal;current:KnowledgeDocument;base:DocumentVersion;close:()=>void}){
  const {command}=useKnowledge(),[parts,setParts]=useState(()=>mergeMarkdown(base.content_md,d.content_md,p.content_md));
  const [resolved,setResolved]=useState<Set<string>>(new Set()),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const titleMerge=mergeValue(base.title,d.title,p.title);const [title,setTitle]=useState(titleMerge.value),[titleResolved,setTitleResolved]=useState(!titleMerge.conflict);
  const [folder,setFolder]=useState(p.folder),[tags,setTags]=useState(p.tags.join(", ")),[due,setDue]=useState(p.review_due_on??""),[metaConfirmed,setMetaConfirmed]=useState(false);
  async function save(){setBusy(true);try{await command({action:"proposal.rebase",id:p.id,expectedVersion:d.current_version,title,content:joinMergeParts(parts),folder,tags:tags.split(",").map(t=>t.trim()).filter(Boolean),reviewDueOn:due});close();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <Modal title="최신 정본과 충돌 해결" onClose={close} busy={busy}><div className="kw-modal-body"><p>기준 v{p.base_version} · 현재 v{d.current_version}. 자동 병합 결과를 확인하고 모든 충돌을 선택하세요.</p>{parts.map((part,i)=><section className="kw-card kw-stack" key={part.id}>{part.conflict?<><h3>본문 충돌 {i+1}</h3><details><summary>기준 내용</summary><pre>{part.base}</pre></details><div className="kw-home-grid"><div><strong>현재 정본</strong><pre>{part.current}</pre><button onClick={()=>{setParts(parts.map(x=>x.id===part.id?{...x,value:part.current,valueLines:part.currentLines}:x));setResolved(new Set([...resolved,part.id]));}}>현재 내용 선택</button></div><div><strong>내 제안</strong><pre>{part.proposed}</pre><button onClick={()=>{setParts(parts.map(x=>x.id===part.id?{...x,value:part.proposed,valueLines:part.proposedLines}:x));setResolved(new Set([...resolved,part.id]));}}>제안 내용 선택</button></div></div><label>직접 편집<textarea value={part.value} onChange={e=>{setParts(parts.map(x=>x.id===part.id?{...x,value:e.target.value,valueLines:e.target.value.split("\n").length}:x));setResolved(new Set([...resolved,part.id]));}}/></label><small>{resolved.has(part.id)?"해결됨":"선택 필요"}</small></>:<pre>{part.value}</pre>}</section>)}<label>제목 {titleMerge.conflict?"· 충돌":""}<input value={title} onChange={e=>{setTitle(e.target.value);setTitleResolved(true);}}/></label>{titleMerge.conflict&&<button onClick={()=>{setTitle(d.title);setTitleResolved(true);}}>현재 제목 사용: {d.title}</button>}<p>속성은 현재 정본과 제안을 함께 확인해 확정하세요. 과거 버전에 속성 스냅샷이 없는 항목은 자동으로 판단하지 않습니다.</p><small>현재 폴더: {d.folder} · 현재 태그: {d.tags.join(", ")} · 현재 검토일: {d.review_due_on||"없음"}</small><label>확정 폴더<input value={folder} onChange={e=>setFolder(e.target.value)}/></label><label>확정 태그<input value={tags} onChange={e=>setTags(e.target.value)}/></label><label>확정 검토일<input type="date" value={due} onChange={e=>setDue(e.target.value)}/></label><label className="kw-actions"><input type="checkbox" checked={metaConfirmed} onChange={e=>setMetaConfirmed(e.target.checked)}/>속성 병합 결과를 확인했습니다</label>{error&&<p className="kw-error">{error}</p>}<footer><button disabled={busy} onClick={close}>취소</button><button className="kw-primary" disabled={busy||!titleResolved||!metaConfirmed||parts.some(p=>p.conflict&&!resolved.has(p.id))} onClick={()=>void save()}>최신 버전 기준으로 저장</button></footer></div></Modal>;
}
