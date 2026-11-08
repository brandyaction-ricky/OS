import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse, ApiError, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { knowledgeAccessContext } from "@/lib/server/knowledge-access";
import { POLICY_FIELDS, readableKnowledgePages } from "@/lib/server/knowledge-page-access";
import { DEFAULT_TEMPLATES } from "@/lib/knowledge/default-templates";
import { emptyKnowledgeState, type KnowledgeState } from "@/lib/knowledge/model";
import { projectMeetings } from "@/lib/knowledge/meetings";
import type { KnowledgeDocument } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function readError(error: { code?: string }, stage: string) {
  // Never log database messages, request bodies, identities or document contents.
  const code = /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(error.code ?? "") ? error.code : "UNKNOWN";
  console.warn("knowledge.workspace.read_failed", { stage, code });
  if (code === "42501") return new ApiError(403,"KNOWLEDGE_FORBIDDEN","회사 문서를 볼 권한을 확인해 주세요.");
  return new ApiError(503,"KNOWLEDGE_READ_FAILED","회사 문서 목록을 불러오지 못했습니다. 잠시 후 다시 불러와 주세요.");
}
function databaseError(error: { code?: string; message?: string }) {
  if (["42P01","42703","PGRST202","PGRST204","PGRST205"].includes(error.code ?? "")) return new ApiError(503,"KNOWLEDGE_SCHEMA_REQUIRED","회사 문서 저장 구조의 배포가 아직 준비되지 않았습니다. 입력한 내용은 지우지 마세요.");
  if (error.code === "PT409" || error.code === "40001" || error.message?.includes("VERSION_CONFLICT")) return new ApiError(409,"VERSION_CONFLICT","다른 사람이 먼저 수정했습니다. 입력한 내용을 보존했습니다.");
  if (error.message?.includes("OS_NOTE_OWNER_ONLY")) return new ApiError(403,"NOTE_OWNER_ONLY","작성자가 「나만 보기」로 정한 노트입니다. 작성자가 공유해야 열 수 있습니다.");
  if (error.code === "42501") return new ApiError(403,"KNOWLEDGE_FORBIDDEN","이 작업을 수행할 권한이 없습니다.");
  if (error.code === "P0002") return new ApiError(404,"KNOWLEDGE_NOT_FOUND","이 항목을 볼 권한이 없습니다.");
  if (error.code === "23505") return new ApiError(409,"KNOWLEDGE_DUPLICATE","같은 이름이나 날짜의 항목이 이미 있습니다. 새로 불러온 뒤 확인해 주세요.");
  return new ApiError(400,"KNOWLEDGE_COMMAND_FAILED","저장하지 못했습니다. 필수 입력값·상태·승인자를 확인해 주세요.");
}
export async function GET(request: Request) {
  try {
    const user = await authenticateRequest(request);
    const db = user.supabase, service = createServiceSupabase();
    const state = emptyKnowledgeState();
    // Server-Timing: which stage is slow (1.25–2 s and 3 MB on 2026-11-02).
    const timing: string[] = [], started = Date.now();
    let mark = started;
    const lap = (name: string) => { const now = Date.now(); timing.push(`${name};dur=${Math.round(now - mark)}`); mark = now; };
    // 바뀐 것만 (대표 결정 2026-11-02): a browser that kept the list sends when it last synced and gets the documents written
    // since, plus every visible id so the ones it may no longer see drop out. The next sync starts 30 s earlier than this read
    // so a write in flight or a clock difference is sent twice rather than missed.
    const sinceMatch = /[?&]since=([^&]+)/.exec(request.url), sinceParam = sinceMatch ? decodeURIComponent(sinceMatch[1]) : null;
    const since = sinceParam && !Number.isNaN(Date.parse(sinceParam)) ? Date.parse(sinceParam) : null;
    const syncedAt = new Date(started - 30_000).toISOString();
    // RLS filters each page; do not accept client supplied actor or permissions.
    // Supporting reads do not depend on the document list; start them together.
    const resourceReads = [
      db.from("os_doc_categories").select("*").is("archived_at",null).order("sort_order"),
      db.from("os_doc_templates").select("*").order("sort_order"),
      db.from("os_note_inbox").select("*").eq("owner_id",user.ownerId).is("processed_at",null).order("created_at",{ascending:false}),
      db.from("os_document_pins").select("document_id").eq("user_id",user.ownerId).order("document_id"),
      db.from("os_document_drafts").select("*").eq("user_id",user.ownerId).order("document_id"),
      db.from("os_records").select("*").eq("record_type","meeting").is("archived_at",null).order("starts_at",{ascending:false}),
      db.from("os_meeting_attendees").select("meeting_id,user_id").order("meeting_id").order("user_id"),
      db.from("os_document_candidates").select("*").order("submitted_at",{ascending:false}),
      db.from("os_knowledge_events").select("*").order("created_at",{ascending:false}).limit(500),
      service.from("os_profiles").select("id,display_name,role,member_kind").eq("is_active",true),
      db.from("os_records").select("id,title,status,version,owner_id,created_by,created_at,updated_at,parent_id,metadata").eq("record_type","decision").eq("status","decided").is("archived_at",null).order("id"),
    ].map(async(builder,index)=>{
      // Each resource may exceed PostgREST's default row cap. Audit deliberately stays at 500.
      if(index===8)return await builder;
      if(![3,4,6,10].includes(index))builder.order("id");
      const data: NonNullable<Awaited<typeof builder>["data"]>=[];
      for(let offset=0;;offset+=500){const page=await builder.range(offset,offset+499);if(page.error)return {data:null,error:page.error};data.push(...(page.data??[]));if(!page.data||page.data.length<500)break;}
      return {data,error:null};
    });
    const resourcesRead = Promise.all(resourceReads);
    // Proposals are few; read them once alongside the documents and keep those on
    // visible documents instead of one request per 100 visible document ids.
    // Decided proposals are sent without their text (135 approved bodies were ~2 MB), so only open and returned ones read it.
    const PROPOSAL_COLUMNS="id,document_id,base_version,title,folder,brand,team,tags,author_id,agent_key_id,status,reviewer_id,decided_at,note,created_at,updated_at,requested_approver_id,return_kind,author_note,proxy_reason,rebased_from_version,ai_assist,review_due_on";
    const readProposals = async(columns: string,statuses: string[])=>{
      const pages=[];
      for(let pageOffset=0;;pageOffset+=500){
        const page=await service.from("os_document_proposals").select(columns as "*").in("status",statuses).order("created_at",{ascending:false}).order("id").range(pageOffset,pageOffset+499);
        pages.push(page);
        if(page.error||!page.data||page.data.length<500) return pages;
      }
    };
    const proposalsRead = Promise.all([readProposals("*",["open","returned"]),readProposals(PROPOSAL_COLUMNS,["approved","withdrawn"])]).then(reads=>reads.flat());
    // Who may approve, and which person owns each agent key, follow from these reads alone: ask as soon as they arrive.
    const approversRead = resourceReads[9].then(profiles=>Promise.all((profiles.data ?? []).map(async row=>{
      const result=await db.rpc("os_can_approve",{p_actor:row.id,p_author:null});
      if(result.error) throw readError(result.error,"approvers");
      const canApprove=row.member_kind==="staff"&&result.data===true;
      return {id:row.id,display_name:row.display_name,role:row.role,member_kind:row.member_kind,can_approve:canApprove};
    })));
    // Keys are never returned; only their owner identity is needed for the self-approval guard.
    const agentOwnersRead = proposalsRead.then(async pages=>{
      const keyIds=[...new Set(pages.flatMap(page=>page.data ?? []).map(p=>p.agent_key_id).filter(Boolean))];
      if(!keyIds.length) return new Map<string,string|null>();
      const result=await service.from("os_agent_keys").select("id,owner_user_id").in("id",keyIds);
      if(result.error) throw readError(result.error,"agent-owners");
      return new Map((result.data ?? []).map(k=>[k.id as string,k.owner_user_id as string|null]));
    });
    // Pages are checked with the document rows below; from here on only the actor is needed, which reads the profile alone
    // (it used to build the whole access context a second time after that check).
    const accessRead = knowledgeAccessContext(user,[]);
    // A failed document read must not leave these as unhandled rejections.
    for(const read of [resourcesRead,proposalsRead,approversRead,agentOwnersRead,accessRead]) void read.catch(()=>undefined);
    // Keyset pagination avoids re-evaluating hierarchical RLS for every skipped row. Ids are random UUIDs, so eight
    // id ranges read side by side cover the same rows in about one round trip instead of one page after another.
    const DOCUMENT_COLUMNS="id,title,folder,parent_document_id,page_order,status,brand,team,tags,source,source_ref,owner_id,steward_id,created_by,current_version,created_at,updated_at,category_id,work_state,due_on,daily_on,review_due_on,archived_at,archived_by,archived_from_status,retention_hold,meeting_record_id,reader_scope,owner_only";
    const listColumns: string = since===null?DOCUMENT_COLUMNS:`${POLICY_FIELDS},updated_at`;
    const bounds=["0","2","4","6","8","a","c","e"].map((from,index,all)=>({from:`${from}0000000-0000-0000-0000-000000000000`,to:all[index+1]?`${all[index+1]}0000000-0000-0000-0000-000000000000`:null}));
    const slices=await Promise.all(bounds.map(async({from,to})=>{
      const slice: KnowledgeDocument[]=[];
      for(let cursor=from,first=true;;first=false){
        let query=db.from("os_documents").select(listColumns);
        query=first?query.gte("id",cursor):query.gt("id",cursor);
        if(to)query=query.lt("id",to);
        const result=await query.order("id").limit(1000);
        if(result.error) throw readError(result.error,"documents");
        const batch=((result.data ?? []) as unknown as KnowledgeDocument[]).map(row=>({...row,content_md:""}));
        slice.push(...batch);
        if(batch.length<1000) return slice;
        cursor=batch[batch.length-1].id;
      }
    }));
    const rows: KnowledgeDocument[] = slices.flat();
    lap("documents");
    // One ancestor check over every page: parents from other pages are already loaded.
    const readable = await readableKnowledgePages(user,rows);
    lap("access");
    const visible = rows.filter(d=>readable.has(d.id));
    if(since===null) state.documents.push(...visible);
    else {
      // The full summary only for what was written since; light rows above carry the policy fields for the checks.
      const changed=visible.filter(d=>Date.parse(d.updated_at)>=since).map(d=>d.id);
      const chunks=Array.from({length:Math.ceil(changed.length/200)},(_,i)=>changed.slice(i*200,i*200+200));
      for(let i=0;i<chunks.length;i+=4){
        const results=await Promise.all(chunks.slice(i,i+4).map(chunk=>db.from("os_documents").select(DOCUMENT_COLUMNS).in("id",chunk)));
        for(const result of results){ if(result.error) throw readError(result.error,"documents"); state.documents.push(...((result.data ?? []).map(row=>({...row,content_md:""})) as KnowledgeDocument[])); }
      }
      lap("changed");
    }
    const access = await accessRead;
    const resources = await resourcesRead;
    lap("resources");
    const stages=["categories","templates","inbox","pins","drafts","meetings","attendees","candidates","events","people","decisions"];
    for(const [index,result] of resources.entries()) if(result.error) throw readError(result.error,stages[index]);
    const [categories,templates,inbox,pins,drafts,meetings,attendees,candidates,events,,decisions]=resources.map(r=>r.data ?? []);
    state.categories=categories as KnowledgeState["categories"];
    state.templates=templates as KnowledgeState["templates"];
    state.templates=[...DEFAULT_TEMPLATES.filter(t=>!state.templates.some(row=>row.default_key===t.id)),...state.templates.filter(t=>!t.archived_at)];
    state.inbox=inbox as KnowledgeState["inbox"];
    const ids=new Set(visible.map(d=>d.id));
    state.pins=pins.map(row=>row.document_id).filter(id=>ids.has(id));
    state.drafts=(drafts as KnowledgeState["drafts"]).filter(d=>ids.has(d.document_id));
    state.meetings=projectMeetings(meetings as Parameters<typeof projectMeetings>[0],decisions as Parameters<typeof projectMeetings>[1],attendees as Parameters<typeof projectMeetings>[2],access.actor);
    state.candidates=(candidates as KnowledgeState["candidates"]).filter(c=>ids.has(c.document_id));
    state.events=events as KnowledgeState["events"];
    state.people=await approversRead;
    lap("people");
    const me=state.people.find(p=>p.id===user.ownerId);
    access.actor.canApprove=me?.can_approve===true;
    for(const page of await proposalsRead){
      if(page.error) throw readError(page.error,"proposals");
      // Decided proposals keep their row but not their full text (135 approved bodies were ~2 MB of every
      // knowledge page load); the review screen reads one body by id when it is opened.
      state.proposals.push(...(page.data ?? []).filter(row=>ids.has(row.document_id)).map(row=>["open","returned"].includes(row.status)?row:{...row,content_md:"",content_omitted:true}));
    }
    // Newest first across both reads, as the review lists show them.
    state.proposals.sort((a,b)=>a.created_at===b.created_at?(a.id<b.id?-1:1):(a.created_at<b.created_at?1:-1));
    lap("proposals");
    if(state.proposals.some(p=>p.agent_key_id)){
      const agentOwners=await agentOwnersRead;
      state.proposals=state.proposals.map(p=>({...p,agent_owner_id:p.agent_key_id?agentOwners.get(p.agent_key_id) ?? null:null}));
    }
    const visibleTargets=new Set([...ids,...state.categories.map(c=>c.id),...state.templates.map(t=>t.id),...state.meetings.map(m=>m.id),...state.candidates.map(c=>c.id),...state.proposals.map(p=>p.id)]);
    // Keep the audit fact without exposing an inaccessible target ID, title, reason or link.
    state.events=state.events.map(e=>visibleTargets.has(e.target_id)?e:{...e,target_id:"",detail:{title:"볼 수 없는 항목"}});
    lap("rest");
    timing.push(`total;dur=${Date.now() - started}`);
    return NextResponse.json({state,actor:access.actor,schemaReady:true,syncedAt,...(since===null?{}:{delta:{visibleIds:visible.map(d=>d.id)}})},{headers:{"Cache-Control":"private, no-store","Server-Timing":timing.join(", ")}});
  } catch(error) { return apiErrorResponse(error instanceof ApiError ? error : readError({}, "workspace")); }
}
const commandSchema=z.object({action:z.enum([
  "document.create","document.commit","document.draft","document.discard","document.properties","document.duplicate","document.export","document.share","document.archive",
  "note.capture","note.access","link.ignore","pin.toggle","category.save","category.archive","category.batch","inbox.create","inbox.delete","inbox.process",
  "template.save","template.archive","candidate.submit","candidate.decide","candidate.publish","candidate.withdraw","canon.keep","canon.demote","canon.steward",
  "proposal.create","proposal.decide","proposal.rebase","meeting.create","meeting.save","meeting.start","meeting.finish","meeting.review","meeting.correct",
  "trash.restore","trash.purge"
]),id:z.string().uuid().optional(),expectedVersion:z.number().int().positive().optional()}).passthrough();
export async function POST(request: Request) {
  try {
    const actor=await authenticateRequest(request);
    const parsed=commandSchema.safeParse(await parseJson(request,2_000_000));
    if(!parsed.success) throw new ApiError(400,"INVALID_COMMAND","요청 형식을 확인해 주세요.");
    if(parsed.data.action==="candidate.decide"||parsed.data.action==="candidate.publish"){
      const {error: gateError}=await actor.supabase.from("os_profiles").select("canonical_publisher").limit(1);
      if(gateError) throw new ApiError(503,"CANONICAL_GATE_NOT_READY","정본 승인 절차를 준비 중입니다. 관리자에게 문의해 주세요.");
    }
    const {data,error}=parsed.data.action==="candidate.publish"
      ? await actor.supabase.rpc("os_publish_candidate",{p_id:parsed.data.id,p_expected_version:parsed.data.expectedVersion})
      : await actor.supabase.rpc("os_knowledge_command",{p:parsed.data});
    if(error) throw databaseError(error);
    return NextResponse.json(data,{headers:{"Cache-Control":"no-store"}});
  }catch(error){return apiErrorResponse(error);}
}
