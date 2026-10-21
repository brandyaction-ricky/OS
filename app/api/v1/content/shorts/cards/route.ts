import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z,ZodError } from "zod";
import { ApiError,apiErrorResponse,parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { assertHumanOwner,assertSameOrigin } from "@/lib/server/content-automation-v07";
import { createServiceSupabase } from "@/lib/supabase/server";
import { readShortformLongform } from "@/lib/server/shortform-longform";
import { DEFAULT_SHORTFORM_BRIEF } from "@/lib/shortform-production";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const inputSchema=z.object({sourceId:z.string().uuid(),sourceKey:z.string().regex(/^[a-f0-9]{64}$/),clipIds:z.array(z.string().uuid()).min(1).max(12)}).strict();
function time(seconds:number){
  const ms=Math.round(seconds*1000),minutes=Math.floor(ms/60000),rest=ms%60000;
  return `${minutes>=60?String(Math.floor(minutes/60)).padStart(2,"0")+":":""}${String(minutes%60).padStart(2,"0")}:${String(Math.floor(rest/1000)).padStart(2,"0")}.${String(rest%1000).padStart(3,"0")}`;
}
export async function POST(request:Request){
  try{
    assertSameOrigin(request);const actor=await authenticateRequest(request),owner=assertHumanOwner(actor);
    const input=inputSchema.parse(await parseJson(request,5000));
    const {data:source}=await actor.supabase.from("os_records").select("id,title,owner_id,brand").eq("id",input.sourceId)
      .eq("record_type","content_topic").eq("owner_id",owner).is("archived_at",null).maybeSingle();
    if(!source)throw new ApiError(404,"SHORTFORM_SOURCE_MISSING","내 롱폼 원본을 선택해 주세요.");
    const resolved=await readShortformLongform(actor,input.sourceId,input.sourceKey);
    const ids=[...new Set(input.clipIds)];
    const {data:clips,error}=await actor.supabase.from("os_records").select("*").eq("record_type","content_short")
      .eq("parent_id",input.sourceId).in("id",ids).is("archived_at",null);
    if(error||clips?.length!==ids.length)throw new ApiError(404,"SHORTFORM_CLIP_MISSING","선택한 원본의 구간을 다시 확인해 주세요.");
    for(const clip of clips){
      const {start,end}=clip.metadata;
      if(typeof start!=="number"||typeof end!=="number"||!Number.isFinite(start)||!Number.isFinite(end)
        ||start<0||end-start<1||end-start>60||end>resolved.durationSeconds)
        throw new ApiError(422,"SHORTFORM_RANGE_INVALID","각 구간은 실제 원본 안의 1~60초여야 합니다.");
    }
    const service=createServiceSupabase(),items=[];
    for(const clip of clips){
      const hash=createHash("sha256").update([owner,input.sourceId,clip.id].join(":")).digest("hex");
      const id=`${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
      const metadata={space:"personal",channel:"shorts",originalClipId:clip.id,originalSourceId:input.sourceId,
        shortformSource:{id:input.sourceId,key:input.sourceKey},
        shortformBrief:{...DEFAULT_SHORTFORM_BRIEF,mode:"reuse",audience:"원본 영상의 시청자",goal:"원본 롱폼 보기"},
        cuts:[{start:time(clip.metadata.start),end:time(clip.metadata.end),text:(String(clip.metadata.hook??"").trim()||clip.title).slice(0,240),note:"채택한 원본 구간"}]};
      const {error:insertError}=await service.from("os_records").insert({id,record_type:"content_publish",title:clip.title,
        description:"롱폼에서 채택한 구간입니다. 이 카드에서 제작·검수합니다.",owner_id:owner,created_by:owner,updated_by:owner,
        status:"draft",stage:"making",priority:"normal",brand:source.brand,parent_id:null,metadata});
      if(insertError&&insertError.code!=="23505")throw new ApiError(503,"SHORTFORM_CARD_FAILED","제작 카드를 저장하지 못했습니다.");
      // A repeated import opens the existing card; it never overwrites its edited script or review.
      if(insertError){
        const {data:existing}=await service.from("os_records").select("id").eq("id",id).eq("owner_id",owner).eq("record_type","content_publish")
          .eq("metadata->>originalClipId",clip.id).is("archived_at",null).maybeSingle();
        if(!existing)throw new ApiError(409,"SHORTFORM_CARD_UNAVAILABLE","이 구간의 제작 카드가 보관되었거나 변경됐습니다.");
      }
      items.push({id,reused:Boolean(insertError)});
    }
    return NextResponse.json({items},{headers:{"cache-control":"no-store"}});
  }catch(error){return apiErrorResponse(error instanceof ZodError?new ApiError(422,"SHORTFORM_REQUEST_INVALID","선택한 구간을 확인해 주세요."):error);}
}
