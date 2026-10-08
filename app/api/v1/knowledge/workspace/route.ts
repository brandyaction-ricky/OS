import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse, ApiError, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { knowledgeAccessContext } from "@/lib/server/knowledge-access";
import { readableKnowledgePages } from "@/lib/server/knowledge-page-access";
import { DEFAULT_TEMPLATES } from "@/lib/knowledge/default-templates";
import { emptyKnowledgeState, type KnowledgeState } from "@/lib/knowledge/model";
import { projectMeetings } from "@/lib/knowledge/meetings";
import type { KnowledgeDocument } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function databaseError(error: { code?: string; message?: string }) {
  if (["42P01","42703","PGRST202","PGRST204","PGRST205"].includes(error.code ?? "")) return new ApiError(503,"KNOWLEDGE_SCHEMA_REQUIRED","회사 문서 저장 구조의 배포가 아직 준비되지 않았습니다. 입력한 내용은 지우지 마세요.");
  if (error.code === "40001" || error.message?.includes("VERSION_CONFLICT")) return new ApiError(409,"VERSION_CONFLICT","다른 사람이 먼저 수정했습니다. 입력한 내용을 보존했습니다.");
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
    // RLS filters each page; do not accept client supplied actor or permissions.
    for (let offset=0;;offset+=500) {
      const result = await db.from("os_documents").select("id,title,folder,parent_document_id,page_order,status,brand,team,tags,source,source_ref,owner_id,steward_id,created_by,current_version,created_at,updated_at,category_id,work_state,due_on,daily_on,review_due_on,archived_at,archived_by,archived_from_status,retention_hold,meeting_record_id").order("id").range(offset,offset+499);
      if(result.error) throw databaseError(result.error);
      const batch = (result.data ?? []).map(row=>({...row,content_md:""})) as KnowledgeDocument[];
      const readable = await readableKnowledgePages(user,batch);
      state.documents.push(...batch.filter(d=>readable.has(d.id)).map(d=>({...d,content_md:""})));
      if(batch.length<500) break;
    }
    const access = await knowledgeAccessContext(user,state.documents);
    const resources = await Promise.all([
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
    }));
    for(const result of resources) if(result.error) throw databaseError(result.error);
    const [categories,templates,inbox,pins,drafts,meetings,attendees,candidates,events,people,decisions]=resources.map(r=>r.data ?? []);
    state.categories=categories as KnowledgeState["categories"];
    state.templates=templates as KnowledgeState["templates"];
    state.templates=[...DEFAULT_TEMPLATES.filter(t=>!state.templates.some(row=>row.default_key===t.id)),...state.templates.filter(t=>!t.archived_at)];
    state.inbox=inbox as KnowledgeState["inbox"];
    const ids=new Set(state.documents.map(d=>d.id));
    state.pins=pins.map(row=>row.document_id).filter(id=>ids.has(id));
    state.drafts=(drafts as KnowledgeState["drafts"]).filter(d=>ids.has(d.document_id));
    state.meetings=projectMeetings(meetings as Parameters<typeof projectMeetings>[0],decisions as Parameters<typeof projectMeetings>[1],attendees as Parameters<typeof projectMeetings>[2],access.actor);
    state.candidates=(candidates as KnowledgeState["candidates"]).filter(c=>ids.has(c.document_id));
    state.events=events as KnowledgeState["events"];
    state.people=await Promise.all(people.map(async row=>{
      const result=await db.rpc("os_can_approve",{p_actor:row.id,p_author:null});
      if(result.error) throw databaseError(result.error);
      return {id:row.id,display_name:row.display_name,role:row.role,member_kind:row.member_kind,can_approve:row.member_kind==="staff"&&result.data===true};
    }));
    access.actor.canApprove=state.people.find(p=>p.id===user.ownerId)?.can_approve===true;
    const docIds=[...ids];
    for(let offset=0;offset<docIds.length;offset+=100) {
      for(let pageOffset=0;;pageOffset+=500){
        const result=await service.from("os_document_proposals").select("*").in("document_id",docIds.slice(offset,offset+100)).order("created_at",{ascending:false}).order("id").range(pageOffset,pageOffset+499);
        if(result.error) throw databaseError(result.error);
        state.proposals.push(...(result.data ?? []));if(!result.data||result.data.length<500)break;
      }
    }
    // Keys are never returned; only their owner identity is needed for the self-approval guard.
    const keyIds=[...new Set(state.proposals.map(p=>p.agent_key_id).filter(Boolean))];
    if(keyIds.length) {
      const result=await service.from("os_agent_keys").select("id,owner_user_id").in("id",keyIds);
      if(result.error) throw databaseError(result.error);
      state.proposals=state.proposals.map(p=>({...p,agent_owner_id:result.data?.find(k=>k.id===p.agent_key_id)?.owner_user_id ?? null}));
    }
    const visibleTargets=new Set([...ids,...state.categories.map(c=>c.id),...state.templates.map(t=>t.id),...state.meetings.map(m=>m.id),...state.candidates.map(c=>c.id),...state.proposals.map(p=>p.id)]);
    // Keep the audit fact without exposing an inaccessible target ID, title, reason or link.
    state.events=state.events.map(e=>visibleTargets.has(e.target_id)?e:{...e,target_id:"",detail:{title:"볼 수 없는 항목"}});
    return NextResponse.json({state,actor:access.actor,schemaReady:true},{headers:{"Cache-Control":"private, no-store"}});
  } catch(error) { return apiErrorResponse(error); }
}
const commandSchema=z.object({action:z.enum([
  "document.create","document.commit","document.draft","document.discard","document.properties","document.duplicate","document.export","document.share","document.archive",
  "note.capture","note.access","link.ignore","pin.toggle","category.save","category.archive","category.batch","inbox.create","inbox.delete","inbox.process",
  "template.save","template.archive","candidate.submit","candidate.decide","candidate.withdraw","canon.keep","canon.demote","canon.steward",
  "proposal.create","proposal.decide","proposal.rebase","meeting.create","meeting.save","meeting.start","meeting.finish","meeting.review","meeting.correct",
  "trash.restore","trash.purge"
]),id:z.string().uuid().optional(),expectedVersion:z.number().int().positive().optional()}).passthrough();
export async function POST(request: Request) {
  try {
    const actor=await authenticateRequest(request);
    const parsed=commandSchema.safeParse(await parseJson(request,2_000_000));
    if(!parsed.success) throw new ApiError(400,"INVALID_COMMAND","요청 형식을 확인해 주세요.");
    const {data,error}=await actor.supabase.rpc("os_knowledge_command",{p:parsed.data});
    if(error) throw databaseError(error);
    return NextResponse.json(data,{headers:{"Cache-Control":"no-store"}});
  }catch(error){return apiErrorResponse(error);}
}
