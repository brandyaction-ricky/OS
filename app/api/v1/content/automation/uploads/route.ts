import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z,ZodError } from "zod";
import { ApiError,apiErrorResponse,parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { assertHumanOwner,assertSameOrigin } from "@/lib/server/content-automation-v07";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const BUCKET="os-content-media";
const types={
  "image/png":{ext:"png",max:25_000_000},
  "image/jpeg":{ext:"jpg",max:25_000_000},
  "image/webp":{ext:"webp",max:25_000_000},
  "video/mp4":{ext:"mp4",max:5_000_000_000},
} as const;
const input=z.object({kind:z.enum(["asset","template","shorts"]),mime:z.enum(["image/png","image/jpeg","image/webp","video/mp4"]),size:z.number().int().positive()}).strict();
export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const actor=await authenticateRequest(request),ownerId=assertHumanOwner(actor);
    const body=input.parse(await parseJson(request,3000)),rule=types[body.mime];
    if(body.size>rule.max||(body.kind==="shorts")!==(body.mime==="video/mp4"))
      throw new ApiError(422,"AUTOMATION_MEDIA_INVALID","파일 형식이나 크기를 확인해 주세요.");
    const path="automation/"+ownerId+"/"+body.kind+"/"+randomUUID()+"."+rule.ext;
    const service=createServiceSupabase(),bucket=await service.storage.getBucket(BUCKET);
    if(bucket.error&&!/not found/i.test(bucket.error.message))throw new ApiError(503,"AUTOMATION_STORAGE_FAILED","미디어 저장소를 확인하지 못했습니다.");
    if(!bucket.data){
      const created=await service.storage.createBucket(BUCKET,{public:false,fileSizeLimit:5_000_000_000,
        allowedMimeTypes:Object.keys(types)});
      if(created.error&&!/already exists/i.test(created.error.message))
        throw new ApiError(503,"AUTOMATION_STORAGE_FAILED","미디어 저장소를 준비하지 못했습니다.");
    }
    const {data,error}=await service.storage.from(BUCKET).createSignedUploadUrl(path);
    if(error||!data)throw new ApiError(503,"AUTOMATION_UPLOAD_FAILED","업로드 주소를 만들지 못했습니다.");
    return NextResponse.json({path,token:data.token},{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    if(error instanceof ZodError)return apiErrorResponse(new ApiError(422,"AUTOMATION_MEDIA_INVALID","파일 형식이나 크기를 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
export async function GET(request:Request){
  try{
    const actor=await authenticateRequest(request),ownerId=assertHumanOwner(actor);
    const path=new URL(request.url).searchParams.get("path")??"";
    if(!new RegExp("^automation/"+ownerId.replaceAll("-","\\-")+"/(asset|template|shorts)/[0-9a-f-]{36}\\.(png|jpg|webp|mp4)$").test(path))
      throw new ApiError(404,"AUTOMATION_MEDIA_NOT_FOUND","내 파일을 찾을 수 없습니다.");
    const {data,error}=await createServiceSupabase().storage.from(BUCKET).createSignedUrl(path,3600);
    if(error||!data)throw new ApiError(404,"AUTOMATION_MEDIA_NOT_FOUND","내 파일을 찾을 수 없습니다.");
    return NextResponse.json({url:data.signedUrl},{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return apiErrorResponse(error);}
}
