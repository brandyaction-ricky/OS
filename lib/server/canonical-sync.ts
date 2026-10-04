import { createServiceSupabase } from "@/lib/supabase/server";
import { ApiError } from "@/lib/http";
import { fetchCanonicalSource } from "./canonical-source-fetch";
import { beginCanonicalRun, canonicalDbError, canonicalDocument, canonicalHash, failCanonicalRun } from "./canonical-workflow";
import type { RequestActor } from "./auth";

/** Existing daily authenticated job calls this. Off unless separately enabled. */
export async function processCanonicalSync(){
  if(process.env.CANONICAL_SYNC_ENABLED!=="true")return {skipped:"disabled"};
  const service=createServiceSupabase();const cutoff=new Date(Date.now()-24*60*60*1000).toISOString();
  const {data,error}=await service.from("os_canonical_sources").select("*").eq("enabled",true).or(`checked_at.is.null,checked_at.lt.${cutoff}`).order("checked_at",{nullsFirst:true}).limit(3);
  if(error)throw canonicalDbError(error);
  const counts={checked:0,proposed:0,unchanged:0,failed:0};
  for(const source of data??[]){
    let claim=service.from("os_canonical_sources").update({checked_at:new Date().toISOString(),last_status:"checking"}).eq("document_id",source.document_id).eq("revision",source.revision).eq("enabled",true);
    claim=source.checked_at?claim.eq("checked_at",source.checked_at):claim.is("checked_at",null);
    const locked=await claim.select("document_id").maybeSingle();if(locked.error||!locked.data)continue;
    let state="failed";
    try{
      const {data:profile}=await service.from("os_profiles").select("id,role,team,is_active,must_change_password").eq("id",source.owner_id).maybeSingle();
      if(!profile?.is_active||profile.must_change_password||profile.role!=="admin")throw new ApiError(403,"CANON_OWNER_UNAVAILABLE","연결 담당자 확인 필요");
      const actor:RequestActor={id:profile.id,ownerId:profile.id,type:"user",name:"예약 동기화",role:"admin",team:profile.team,brand:null,user:null,organizationId:null,allowedStatuses:["canonical"],scopes:[],mustChangePassword:false,supabase:service};
      const document=await canonicalDocument(actor,source.document_id);
      const content=await fetchCanonicalSource(source.url);
      const {run,fresh}=await beginCanonicalRun(actor,document,"sync","api",`${document.current_version}:${canonicalHash(content)}`);
      let result=run;
      if(fresh){try{const finished=await service.rpc("os_finish_canonical_sync",{p_run:run.id,p_content:content});if(finished.error)throw canonicalDbError(finished.error);result=finished.data;}catch(error){await failCanonicalRun(run.id,error);throw error;}}
      if(result.status!=="done")throw new ApiError(409,"CANON_RUN_PENDING","동기화 확인 필요");
      state=result.result.unchanged?"unchanged":"proposed";if(state==="unchanged")counts.unchanged+=1;else counts.proposed+=1;
    }catch{counts.failed+=1;}
    const saved=await service.from("os_canonical_sources").update({last_status:state}).eq("document_id",source.document_id).eq("revision",source.revision);
    if(saved.error)throw canonicalDbError(saved.error);counts.checked+=1;
  }
  return counts;
}
