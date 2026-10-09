import {NextResponse} from "next/server";
import {ApiError,apiErrorResponse} from "@/lib/http";
import {safeSecretMatch} from "@/lib/server/auth";
import {createServiceSupabase} from "@/lib/supabase/server";

/** No scheduler is registered. Both jobs remain disabled until separately approved. */
export async function runKnowledgeMaintenance(request:Request,kind:"purge"|"reminders"){
  try{
    const expected=process.env.CRON_SECRET??"";
    const received=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")??"";
    if(!expected||!safeSecretMatch(received,expected))throw new ApiError(401,"INVALID_CRON_SECRET","예약 작업 인증에 실패했습니다.");
    const enabled=kind==="purge"?process.env.KNOWLEDGE_TRASH_AUTOPURGE:process.env.KNOWLEDGE_REMINDERS_ENABLED;
    if(enabled!=="true")return NextResponse.json({ok:true,skipped:"disabled"},{headers:{"Cache-Control":"no-store"}});
    const {data,error}=await createServiceSupabase().rpc(kind==="purge"?"os_workspace_purge_expired":"os_workspace_send_reminders");
    if(error)throw new ApiError(503,"KNOWLEDGE_MAINTENANCE_FAILED","회사 문서 예약 작업을 완료하지 못했습니다.");
    return NextResponse.json({ok:true,count:data},{headers:{"Cache-Control":"no-store"}});
  }catch(error){return apiErrorResponse(error);}
}
