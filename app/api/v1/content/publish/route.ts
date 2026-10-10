import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { publicationSettingsSchema } from "@/lib/channel-publishing";
import { authenticateRequest } from "@/lib/server/auth";
import { authorizeMetaConnection, assertMetaModeMatches } from "@/lib/server/meta-oauth";
import { assertPublicationApprovalForEnvironment, invalidatePublicationApprovalCheckpoint, publicationSignature, publicationSourceVersion, publishChannelRecord, readPublication, savePublication, signPublicationMedia, storePublicationApprovalCheckpoint, validatePublicationSettings } from "@/lib/server/channel-publication";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const requestSchema=z.object({id:z.string().uuid(),expectedVersion:z.number().int().positive(),operation:z.enum(["edit","approve","schedule","reschedule","publish","manual_done"]),settings:publicationSettingsSchema.optional(),startsAt:z.string().datetime().optional(),permalink:z.string().url().optional(),confirm:z.boolean().optional()});
export async function POST(request:Request){
  try{
    const actor=await authenticateRequest(request);
    const input=requestSchema.parse(await parseJson(request,100_000));
    let current=await readPublication(actor,input.id);
    if(current.metadata?.space==="personal")
      throw new ApiError(403,"PERSONAL_AUTOMATION_API_REQUIRED","개인 자동화 콘텐츠는 최종 확인과 발행 화면에서 처리해 주세요.");
    if(current.version!==input.expectedVersion)throw new ApiError(409,"PUBLICATION_CHANGED","게시물이 변경됐습니다. 새로 불러와 주세요.");
    const previous=publicationSettingsSchema.safeParse(current.metadata);
    if(previous.success)await authorizeMetaConnection(actor,previous.data.account.ownerId,previous.data.account.platform);
    const settings=input.operation==="edit"?input.settings:previous.success?previous.data:undefined;
    if(!settings)throw new ApiError(400,"PUBLICATION_SETTINGS_REQUIRED","게시 계정과 문안을 먼저 저장해 주세요.");
    const connection=await authorizeMetaConnection(actor,settings.account.ownerId,settings.account.platform);
    assertMetaModeMatches(connection);
    if(input.operation==="publish"){
      if(input.confirm!==true)throw new ApiError(400,"HUMAN_CONFIRMATION_REQUIRED","사람이 게시 내용을 확인해야 합니다.");
      return NextResponse.json({record:await publishChannelRecord(actor,current)});
    }
    if(current.status==="published")throw new ApiError(409,"PUBLICATION_FINISHED","게시된 문안은 덮어쓰지 않습니다.");
    if((current.metadata.publishOperation as {state?:string}|undefined)?.state==="running")throw new ApiError(409,"PUBLICATION_BUSY","게시 결과 처리 중에는 수정할 수 없습니다.");
    if(input.operation==="reschedule"){
      if(!input.startsAt||Date.parse(input.startsAt)<=Date.now())throw new ApiError(400,"PUBLICATION_TIME_REQUIRED","미래 예약 시각을 입력해 주세요.");
      if(current.status==="scheduled")await assertPublicationApprovalForEnvironment(current,settings,await publicationSourceVersion(actor,current));
      current=await savePublication(actor,current,{starts_at:input.startsAt,metadata:{...current.metadata,confirmationDue:false}});
    }else if(input.operation==="edit"){
      if((current.metadata.externalIds as unknown[]|undefined)?.length)throw new ApiError(409,"PUBLICATION_PARTIAL","일부 게시된 글타래는 문안을 바꾸지 않고 남은 부분부터 처리해 주세요.");
      current=await savePublication(actor,current,{description:settings.caption,status:"review",metadata:{...current.metadata,...settings,channelWorkflowVersion:1,needsRecheck:true,publicationApproval:null,publishError:null,publishCheckpoint:{receipts:[]},externalIds:[]}});
      await invalidatePublicationApprovalCheckpoint(current.id);
    }else{
      validatePublicationSettings(settings);
      const sourceVersion=await publicationSourceVersion(actor,current);
      if(input.operation==="approve"){
        if(input.confirm!==true)throw new ApiError(400,"HUMAN_CONFIRMATION_REQUIRED","문안·계정·파일을 확인한 뒤 승인해 주세요.");
        await signPublicationMedia(current,settings,false);
        const signature=publicationSignature(current,settings,sourceVersion);
        await storePublicationApprovalCheckpoint(current,signature,sourceVersion,actor.id);
        current=await savePublication(actor,current,{status:"ready",metadata:{...current.metadata,needsRecheck:false,publicationApproval:{signature,sourceVersion,actorId:actor.id,at:new Date().toISOString()}}});
      }else{
        await assertPublicationApprovalForEnvironment(current,settings,sourceVersion);
        if(input.operation==="schedule"){
          if(!input.startsAt||Date.parse(input.startsAt)<=Date.now())throw new ApiError(400,"PUBLICATION_TIME_REQUIRED","미래 예약 시각을 입력해 주세요.");
          current=await savePublication(actor,current,{status:"scheduled",starts_at:input.startsAt,metadata:{...current.metadata,scheduledBy:actor.id,confirmationDue:false}});
        }else if(input.operation==="manual_done"){
          if(settings.publishMode!=="manual"||input.confirm!==true||!input.permalink)throw new ApiError(400,"MANUAL_RECEIPT_REQUIRED","직접 게시한 주소와 완료 확인이 필요합니다.");
          const url=new URL(input.permalink),allowed=settings.account.platform==="instagram"?["instagram.com","www.instagram.com"]:["threads.net","www.threads.net","threads.com","www.threads.com"];
          if(url.protocol!=="https:"||url.username||url.password||!allowed.includes(url.hostname))throw new ApiError(400,"MANUAL_RECEIPT_INVALID","선택한 플랫폼의 HTTPS 게시물 주소를 입력해 주세요.");
          current=await savePublication(actor,current,{status:"published",source_url:url.href,metadata:{...current.metadata,permalink:url.href,publishedAt:new Date().toISOString(),postedBy:actor.id,receiptSource:"manual",manualTasks:[]}});
        }
      }
    }
    return NextResponse.json({record:current});
  }catch(error){
    if(error instanceof ZodError)return apiErrorResponse(new ApiError(400,"PUBLICATION_INPUT_INVALID","게시 설정 입력을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
