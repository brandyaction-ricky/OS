import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    let query = actor.supabase.from("os_records").select("id,title,status,owner_id,metadata,version").eq("record_type","connection").eq("metadata->>kind","meta_tester_request").is("archived_at",null);
    if (actor.role !== "admin") query = query.eq("owner_id",actor.id);
    const {data,error} = await query.order("created_at",{ascending:false});
    if (error) throw new ApiError(500,"TESTER_LIST_FAILED","테스터 요청 상태를 확인하지 못했습니다.");
    return NextResponse.json({requests:data??[]});
  } catch(error) {return apiErrorResponse(error);}
}
export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request), service = createServiceSupabase();
    const input = z.object({platform:z.enum(["instagram","threads"])}).parse(await parseJson(request));
    const {data:existing,error:readError} = await service.from("os_records").select("id").eq("record_type","connection").eq("owner_id",actor.id).eq("metadata->>kind","meta_tester_request").eq("metadata->>platform",input.platform).eq("status","backlog").is("archived_at",null).limit(1).maybeSingle();
    if(readError) throw new ApiError(500,"TESTER_READ_FAILED","요청 중복을 확인하지 못했습니다.");
    if(existing) return NextResponse.json({requested:true,recordId:existing.id});
    const {data:admins,error:adminError} = await service.from("os_profiles").select("id").eq("role","admin").eq("is_active",true);
    if(adminError||!admins?.length) throw new ApiError(409,"TESTER_ADMIN_REQUIRED","요청을 받을 활성 관리자가 없습니다.");
    const {data,error} = await service.from("os_records").insert({record_type:"connection",title:`${input.platform} 테스터 등록 요청`,status:"backlog",owner_id:actor.id,created_by:actor.id,updated_by:actor.id,metadata:{kind:"meta_tester_request",platform:input.platform,testerStatus:"requested"}}).select("id,version").single();
    if(error||!data) throw new ApiError(500,"TESTER_SAVE_FAILED","테스터 요청을 저장하지 못했습니다.");
    for(const admin of admins) {
      const {error:notificationError}=await service.rpc("os_enqueue_work_notification",{recipient:admin.id,actor:actor.id,source_type:"record",source_id:data.id,reason:"approval",source_version:String(data.version)});
      if(notificationError) throw new ApiError(503,"TESTER_NOTIFICATION_PENDING","요청은 저장했지만 관리자 알림은 전달하지 못했습니다. 내 계정의 요청 목록에서 확인해 주세요.");
    }
    return NextResponse.json({requested:true,recordId:data.id});
  } catch(error) {return apiErrorResponse(error);}
}
export async function PATCH(request: Request) {
  try {
    const actor=await authenticateRequest(request);
    if(actor.role!=="admin") throw new ApiError(403,"ADMIN_REQUIRED","관리자만 테스터 등록 확인을 남길 수 있습니다.");
    const input=z.object({id:z.string().uuid(),expectedVersion:z.number().int().positive(),registered:z.literal(true)}).parse(await parseJson(request));
    const service=createServiceSupabase();
    const {data:current}=await service.from("os_records").select("*").eq("id",input.id).eq("record_type","connection").eq("metadata->>kind","meta_tester_request").is("archived_at",null).maybeSingle();
    if(!current) throw new ApiError(404,"TESTER_NOT_FOUND","테스터 등록 요청이 없습니다.");
    const {data,error}=await service.from("os_records").update({status:"done",updated_by:actor.id,metadata:{...current.metadata,testerStatus:"registered",registeredAt:new Date().toISOString(),registeredBy:actor.id}}).eq("id",input.id).eq("version",input.expectedVersion).select("id,version").maybeSingle();
    if(error||!data) throw new ApiError(409,"TESTER_CHANGED","요청이 변경됐습니다. 새로 불러와 주세요.");
    const {error:noticeError}=await service.rpc("os_enqueue_work_notification",{recipient:current.owner_id,actor:actor.id,source_type:"record",source_id:data.id,reason:"status_change",source_version:String(data.version)});
    if(noticeError) throw new ApiError(503,"TESTER_NOTIFICATION_PENDING","등록 확인은 저장했지만 알림 전달은 대기 중입니다.");
    return NextResponse.json({registered:true});
  } catch(error) {return apiErrorResponse(error);}
}
