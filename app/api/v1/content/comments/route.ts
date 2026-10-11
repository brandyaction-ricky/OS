import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { canUseConnection } from "@/lib/server/channel-access";
import { createServiceSupabase } from "@/lib/supabase/server";
import { collectedCommentId, moderateChannelComment, readChannelComment, saveChannelComment } from "@/lib/server/channel-comments";
import { beginGenerationJob, finishGenerationJob } from "@/lib/server/content-generation-queue";
import { generateCommentReplyText } from "@/lib/server/content-generation";
import type { OsRecord } from "@/lib/record-types";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=120;
const inputSchema=z.object({id:z.string().uuid(),expectedVersion:z.number().int().positive(),operation:z.enum(["assign","classify","reply","hide","topic","draft"]),assigneeId:z.string().uuid().nullable().optional(),kind:z.enum(["question","reaction","spam","sensitive","unclassified"]).optional(),text:z.string().trim().max(500).optional(),confirm:z.boolean().optional(),mode:z.enum(["queue","api"]).default("queue")});
export async function GET(request:Request){
  try{
    const actor=await authenticateRequest(request);
    const {data,error}=await actor.supabase.from("os_records").select("*").eq("record_type","content_comment").is("archived_at",null).order("created_at",{ascending:false}).limit(200);
    if(error)throw new ApiError(503,"COMMENT_READ_FAILED","댓글 저장소 준비 상태를 확인해 주세요.");
    const rows=((data??[]) as OsRecord[]).filter(row=>row.metadata.space!=="personal"),owners=[...new Set(rows.map(row=>String(row.metadata.connectionOwnerId)))];
    const connections=owners.length?await createServiceSupabase().from("os_meta_connections").select("owner_id,platform,team_shared").in("owner_id",owners):{data:[],error:null};
    if(connections.error)throw new ApiError(503,"COMMENT_CHANNELS_UNAVAILABLE","댓글 처리 권한을 확인하지 못했습니다.");
    return NextResponse.json({comments:rows.map(row=>{const connection=connections.data?.find(item=>item.owner_id===row.metadata.connectionOwnerId&&item.platform===row.metadata.platform);return {...row,canRespond:!!connection&&canUseConnection(actor,connection),teamShared:connection?.team_shared===true};}),truncated:rows.length===200},{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return apiErrorResponse(error);}
}
export async function POST(request:Request){
  try{
    const actor=await authenticateRequest(request),input=inputSchema.parse(await parseJson(request,8000));
    const row=await readChannelComment(actor,input.id);
    if(row.metadata.space==="personal")throw new ApiError(403,"PERSONAL_AUTOMATION_API_REQUIRED","개인 콘텐츠 댓글은 콘텐츠 자동화에서 처리해 주세요.");
    if(row.version!==input.expectedVersion)throw new ApiError(409,"COMMENT_CHANGED","댓글이 변경되었습니다. 다시 불러와 주세요.");
    if(input.operation==="reply"||input.operation==="hide"){
      if(input.confirm!==true)throw new ApiError(400,"HUMAN_CONFIRMATION_REQUIRED","답글·숨기기는 사람이 확인해야 합니다.");
      return NextResponse.json({comment:await moderateChannelComment(actor,row,input.operation,input.text??"")});
    }
    if(input.operation==="assign"){
      if(input.assigneeId===undefined)throw new ApiError(400,"COMMENT_ASSIGNEE_REQUIRED","담당자를 선택해 주세요.");
      if(input.assigneeId){const {data,error}=await actor.supabase.from("os_profiles").select("id").eq("id",input.assigneeId).eq("is_active",true).maybeSingle();if(error||!data)throw new ApiError(400,"COMMENT_ASSIGNEE_INVALID","활성 구성원만 담당할 수 있습니다.");}
      return NextResponse.json({comment:await saveChannelComment(actor,row,{assignee_id:input.assigneeId})});
    }
    if(input.operation==="classify"){
      if(!input.kind)throw new ApiError(400,"COMMENT_KIND_REQUIRED","분류를 선택해 주세요.");
      return NextResponse.json({comment:await saveChannelComment(actor,row,{metadata:{...row.metadata,kind:input.kind}})});
    }
    if(input.operation==="topic"){
      const id=collectedCommentId("topic",row.id,"draft");
      const {error}=await actor.supabase.from("os_records").upsert({id,record_type:"content_topic",title:row.description.slice(0,160)||"댓글에서 찾은 주제",description:row.description,status:"draft",owner_id:actor.id,created_by:actor.id,updated_by:actor.id,metadata:{origin:"own",sourceCommentId:row.id,sourcePublishId:row.parent_id}},{onConflict:"id",ignoreDuplicates:true});
      if(error)throw new ApiError(409,"COMMENT_TOPIC_FAILED","주제 초안을 저장하지 못했습니다.");
      const topic=await actor.supabase.from("os_records").select("id").eq("id",id).maybeSingle();if(topic.error||!topic.data)throw new ApiError(403,"COMMENT_TOPIC_UNAVAILABLE","주제 초안 접근을 확인하지 못했습니다.");
      return NextResponse.json({topicId:id,comment:await saveChannelComment(actor,row,{metadata:{...row.metadata,topicId:id}})});
    }
    const documents=await actor.supabase.from("os_documents").select("title,content_md").eq("status","canonical").or("title.ilike.%댓글%,title.ilike.%응대%").limit(5);
    if(documents.error)throw new ApiError(503,"COMMENT_PROCEDURE_READ_FAILED","댓글 절차를 읽지 못했습니다.");
    const procedure=documents.data?.length?documents.data.map(doc=>`${doc.title}\n${String(doc.content_md).slice(0,5000)}`).join("\n"):"OS 기본 절차: 질문을 정확히 확인하고 사실만 간결하게 답합니다. 확인되지 않은 내용은 담당자 확인을 안내합니다. 사람이 수정·확인하기 전에는 게시하지 않습니다.";
    const job=await beginGenerationJob(actor,row,{action:"comment_reply",mode:input.mode},procedure);
    if(input.mode==="queue")return NextResponse.json({queued:true,jobId:job.id},{status:202});
    try{
      const generated=await generateCommentReplyText(row.description,procedure);
      const saved=await saveChannelComment(actor,row,{metadata:{...row.metadata,replyDraft:generated.reply,draftGenerationId:job.id,draftProcedure:documents.data?.length?"canonical":"fallback"}});
      await finishGenerationJob(actor,job,[saved],{model:generated.model,usage:generated.usage,costUsd:generated.costUsd});
      return NextResponse.json({comment:saved,jobId:job.id});
    }catch(error){await finishGenerationJob(actor,job,[],{},error instanceof ApiError?error.code:"COMMENT_DRAFT_FAILED");throw error;}
  }catch(error){return apiErrorResponse(error instanceof ZodError?new ApiError(400,"COMMENT_INPUT_INVALID","댓글 입력을 확인해 주세요."):error);}
}
