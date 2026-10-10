import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";

export async function enqueueAutomationNotification(input:{ownerId:string;sourceType:"record"|"browser";sourceId:string;reason:"ai_result"|"computer_silent"|"publish_due";dedupeKey:string}){
  const {error}=await createServiceSupabase().from("os_records").insert({
    record_type:"notification",title:"업무 알림",description:"",status:"unread",
    owner_id:input.ownerId,created_by:input.ownerId,updated_by:input.ownerId,
    metadata:{sourceType:input.sourceType,sourceId:input.sourceId,reason:input.reason,
      readAt:"",dedupeKey:`content-automation:${input.ownerId}:${input.dedupeKey}`},
  });
  if(error&&error.code!=="23505")throw new ApiError(503,"AUTOMATION_NOTICE_FAILED","자동화 알림을 기록하지 못했습니다.");
}
