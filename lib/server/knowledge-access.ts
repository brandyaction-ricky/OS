import type { RequestActor } from "./auth";
import type { AccessDocument, KnowledgeAccessContext, KnowledgeActor } from "@/lib/knowledge/access";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
export { canReadDocument, filterReadable, canEditDocument, canChangeCategory, canManageCategory, canDecideProposal } from "@/lib/knowledge/access";

/** Hydrate policy context on the server. Missing related rows fail closed. */
export async function knowledgeAccessContext(actor: RequestActor, documents: AccessDocument[], allowAgentPrivateGrant = false) {
  const service = createServiceSupabase();
  const { data: profile, error } = await service.from("os_profiles").select("*").eq("id", actor.ownerId).maybeSingle();
  if (error || !profile?.is_active) throw new ApiError(403, "KNOWLEDGE_ACCESS_UNAVAILABLE", "문서 열람 권한을 확인하지 못했습니다.");
  const policyActor: KnowledgeActor = { ownerId:actor.ownerId,type:actor.type,role:actor.role,allowedStatuses:actor.allowedStatuses,memberKind: profile.member_kind ?? "staff", active: profile.is_active };
  const context: KnowledgeAccessContext = { categories: new Map(), meetings: new Map(), noteGrants: new Set() };
  if(actor.type==="agent"&&allowAgentPrivateGrant){
    const owners=new Map(documents.filter(d=>d.status==="draft"&&d.id).map(d=>[d.id!,d.owner_id]));
    const privateIds=documents.filter(d=>d.status==="draft").map(d=>d.id).filter((id):id is string=>Boolean(id));
    const candidates=new Set<string>();
    for(let offset=0;offset<privateIds.length;offset+=200){
      const result=await service.from("os_agent_document_read_grants")
        .select("document_id,grantee_owner_id,granted_by,expires_at,revoked_at")
        .eq("agent_key_id",actor.id).in("document_id",privateIds.slice(offset,offset+200));
      // The application can be released before its additive migration.
      if(["42P01","PGRST205"].includes(result.error?.code??""))break;
      if(result.error)throw new ApiError(503,"KNOWLEDGE_ACCESS_UNAVAILABLE","AI 문서 열람 권한을 확인하지 못했습니다.");
      for(const row of result.data??[])if(row.grantee_owner_id===actor.ownerId&&row.granted_by===owners.get(row.document_id)&&!row.revoked_at&&(!row.expires_at||Date.parse(row.expires_at)>Date.now()))candidates.add(row.document_id);
    }
    if(candidates.size){
      const grantors=[...new Set([...candidates].map(id=>owners.get(id)).filter((id):id is string=>Boolean(id)))];
      const profiles=await service.from("os_profiles").select("id,is_active").in("id",grantors);
      if(profiles.error)throw new ApiError(503,"KNOWLEDGE_ACCESS_UNAVAILABLE","AI 문서 열람 권한을 확인하지 못했습니다.");
      const activeOwners=new Set((profiles.data??[]).filter(row=>row.is_active).map(row=>row.id));
      context.agentDocumentGrants=new Set([...candidates].filter(id=>activeOwners.has(owners.get(id)??"")));
    }
  }
  if(actor.type==="user"&&actor.role==="admin"){
    const privateIds=documents.filter(d=>d.owner_id!==actor.ownerId&&(d.status==="draft"||d.archived_from_status==="draft")).map(d=>d.id).filter((id):id is string=>Boolean(id));
    const granted=new Set<string>();
    for(let offset=0;offset<privateIds.length;offset+=200){
      const result=await service.from("os_note_access_grants").select("document_id").eq("admin_id",actor.ownerId).gt("expires_at",new Date().toISOString()).in("document_id",privateIds.slice(offset,offset+200));
      if(result.error)throw new ApiError(503,"KNOWLEDGE_ACCESS_UNAVAILABLE","임시 열람 권한을 확인하지 못했습니다.");
      for(const row of result.data??[])granted.add(row.document_id);
    }
    context.noteGrants=granted;
  }
  const categories = [...new Set(documents.map(doc => doc.category_id).filter((id): id is string => Boolean(id)))];
  if (categories.length && policyActor.memberKind === "partner") {
    const map=new Map<string,{partner_ids:string[];archived_at:string|null}>();
    for(let offset=0;offset<categories.length;offset+=200){
      const result=await service.from("os_doc_categories").select("id,partner_ids,archived_at").in("id",categories.slice(offset,offset+200));
      if(result.error)throw new ApiError(503,"KNOWLEDGE_ACCESS_UNAVAILABLE","문서 열람 권한을 확인하지 못했습니다.");
      for(const row of result.data??[])map.set(row.id,row);
    }
    context.categories=map;
  }
  const meetings = [...new Set(documents.map(doc => doc.meeting_record_id).filter((id): id is string => Boolean(id)))];
  if (meetings.length) {
    const map=new Map<string,{visibility:string;attendees:string[]}>();
    for(let offset=0;offset<meetings.length;offset+=200){
      const ids=meetings.slice(offset,offset+200);
      const records=await service.from("os_records").select("id,metadata").eq("record_type","meeting").is("archived_at",null).in("id",ids);
      if(records.error)throw new ApiError(503,"KNOWLEDGE_ACCESS_UNAVAILABLE","회의 열람 권한을 확인하지 못했습니다.");
      for(const row of records.data??[])map.set(row.id,{visibility:row.metadata?.visibility??"attendees",attendees:[]});
      for(let page=0;;page+=500){
        const attendees=await service.from("os_meeting_attendees").select("meeting_id,user_id").in("meeting_id",ids).order("meeting_id").order("user_id").range(page,page+499);
        if(attendees.error)throw new ApiError(503,"KNOWLEDGE_ACCESS_UNAVAILABLE","회의 열람 권한을 확인하지 못했습니다.");
        for(const row of attendees.data??[])map.get(row.meeting_id)?.attendees.push(row.user_id);
        if(!attendees.data||attendees.data.length<500)break;
      }
    }
    context.meetings=map;
  }
  return { actor: policyActor, context };
}
