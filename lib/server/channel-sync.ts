import { createHash } from "node:crypto";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { OsRecord } from "@/lib/record-types";

export function channelReminderRecipients(record: Pick<OsRecord,"metadata">, shared: boolean) {
  const owner=String((record.metadata.account as {ownerId?:string}|undefined)?.ownerId??"");
  const scheduledBy=String(record.metadata.scheduledBy??"");
  return [...new Set([owner,...(shared?[scheduledBy]:[])].filter(value=>/^[0-9a-f-]{36}$/.test(value)))];
}
function reminderId(key:string){const digest=createHash("sha256").update(key).digest("hex");return `${digest.slice(0,8)}-${digest.slice(8,12)}-5${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;}

async function privateTelegramReminder(recipient:string) {
  if(!process.env.TELEGRAM_BOT_TOKEN)return "unconfigured";
  const {data,error}=await createServiceSupabase().from("os_telegram_users").select("external_chat_id,external_user_id").eq("profile_id",recipient).eq("status","approved");
  if(error)return "failed";
  // Never deliver a personal reminder to a group or to an unmapped Telegram ID.
  const chats=[...new Set((data??[]).filter(row=>String(row.external_chat_id)===String(row.external_user_id)).map(row=>String(row.external_chat_id)))];
  if(!chats.length)return "unconfigured";
  try{
    for(const chat of chats){
      const response=await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:chat,text:"OS에서 확인할 콘텐츠 운영 알림이 있습니다. OS 알림함에서 확인해 주세요."}),signal:AbortSignal.timeout(10000)});
      const body=await response.json().catch(()=>({}));if(!response.ok||body.ok!==true)return "failed";
    }
    return "sent";
  }catch{return "failed";}
}

// Only a separately enabled authenticated cron calls this function. It never
// publishes, replies, hides, changes approvals or changes scheduled status.
export async function syncChannelReminders(now=new Date()) {
  const db=createServiceSupabase();
  const [{data:due,error:dueError},{data:connections,error:connectionError}]=await Promise.all([
    db.from("os_records").select("id,metadata,starts_at").eq("record_type","content_publish").eq("status","scheduled").is("archived_at",null).lte("starts_at",now.toISOString()).order("starts_at").limit(200),
    db.from("os_meta_connections").select("owner_id,platform,team_shared,token_expires_at,status").limit(500),
  ]);
  if(dueError||connectionError)throw new ApiError(503,"CHANNEL_SYNC_SCHEMA_REQUIRED","채널 동기화 DB 준비 상태를 확인해 주세요.");
  const counts={notifications:0,telegramSent:0,telegramFailed:0,telegramUnconfigured:0,truncated:(due?.length??0)===200||(connections?.length??0)===500};
  const enqueue=async(recipient:string,sourceId:string,key:string)=>{
    const {data:inserted,error}=await db.rpc("os_enqueue_channel_reminder",{recipient,source_id:sourceId,reminder_key:key});
    if(error)throw new ApiError(503,"CHANNEL_REMINDER_UNAVAILABLE","예약 알림 저장 준비가 필요합니다.");
    if(inserted){counts.notifications++;const result=await privateTelegramReminder(recipient);if(result==="sent")counts.telegramSent++;else if(result==="failed")counts.telegramFailed++;else counts.telegramUnconfigured++;}
  };
  for(const row of due??[]){
    const account=row.metadata?.account;
    const connection=connections?.find(item=>item.owner_id===account?.ownerId&&item.platform===account?.platform);
    if(!connection)continue;
    for(const recipient of channelReminderRecipients(row as Pick<OsRecord,"metadata">,connection.team_shared))await enqueue(recipient,row.id,`scheduled:${row.starts_at}`);
  }
  for(const connection of connections??[]){
    const expires=Date.parse(connection.token_expires_at??"");
    if(!Number.isFinite(expires)||expires>now.getTime()+7*86400000)continue;
    const id=reminderId(`expiry:${connection.owner_id}:${connection.platform}:${connection.token_expires_at}`);
    const {error}=await db.from("os_records").upsert({id,record_type:"connection",title:`${connection.platform==="instagram"?"인스타":"Threads"} 연결 만료 확인`,status:"blocked",owner_id:connection.owner_id,created_by:connection.owner_id,updated_by:connection.owner_id,metadata:{kind:"channel_expiry",platform:connection.platform,expiresAt:connection.token_expires_at}},{onConflict:"id",ignoreDuplicates:true});
    if(error)throw new ApiError(503,"CHANNEL_REMINDER_UNAVAILABLE","연결 만료 알림을 준비하지 못했습니다.");
    await enqueue(connection.owner_id,id,`expiry:${connection.token_expires_at}`);
  }
  return counts;
}
