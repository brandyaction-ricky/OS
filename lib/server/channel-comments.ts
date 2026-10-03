import { createHash } from "node:crypto";
import { ApiError } from "@/lib/http";
import { mayHideComment } from "@/lib/content-comments";
import type { OsRecord } from "@/lib/record-types";
import type { RequestActor } from "./auth";
import { authorizeMetaConnection, assertMetaModeMatches, metaMode, type MetaConnection } from "./meta-oauth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { collectPostComments } from "./meta-collection";
export function collectedCommentId(platform:string,owner:string,externalId:string){const hex=createHash("sha256").update(JSON.stringify(["channel-comment",platform,owner,externalId])).digest("hex");return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;}
export async function readChannelComment(actor:RequestActor,id:string){
  const {data,error}=await actor.supabase.from("os_records").select("*").eq("id",id).eq("record_type","content_comment").is("archived_at",null).maybeSingle();
  if(error||!data)throw new ApiError(404,"COMMENT_NOT_FOUND","댓글을 확인하지 못했습니다.");return data as OsRecord;
}
export async function saveChannelComment(actor:RequestActor,row:OsRecord,changes:Partial<OsRecord>){const {data,error}=await actor.supabase.from("os_records").update({...changes,updated_by:actor.id}).eq("id",row.id).eq("version",row.version).select("*").maybeSingle();if(error||!data)throw new ApiError(409,"COMMENT_CHANGED","댓글이 변경되었습니다. 다시 불러와 주세요.");return data as OsRecord;}
export async function moderateChannelComment(actor:RequestActor,row:OsRecord,operation:"reply"|"hide",text:string){
  const platform=row.metadata.platform;if(platform!=="instagram"&&platform!=="threads")throw new ApiError(400,"COMMENT_PLATFORM_INVALID","댓글 플랫폼을 확인해 주세요.");
  const connection=await authorizeMetaConnection(actor,String(row.metadata.connectionOwnerId),platform);assertMetaModeMatches(connection);
  if(operation==="hide"&&!mayHideComment(platform,row.metadata.topLevel===true))throw new ApiError(400,"THREADS_ROOT_ONLY","Threads는 게시물의 최상위 답글만 숨길 수 있습니다.");
  if(operation==="reply"&&(!text.trim()||Array.from(text).length>500))throw new ApiError(400,"COMMENT_REPLY_INVALID","답글은 1~500자로 입력해 주세요.");
  if(metaMode()!=="mock")throw new ApiError(503,"LIVE_MODERATION_NOT_RELEASED","실계정 답글·숨기기는 권한·게시 검수 후 별도로 활성화합니다.");
  if(row.status==="hidden"||row.status==="replied")throw new ApiError(409,"COMMENT_ALREADY_HANDLED","이미 처리한 댓글입니다. 결과를 확인해 주세요.");
  return saveChannelComment(actor,row,{status:operation==="reply"?"replied":"hidden",metadata:{...row.metadata,...(operation==="reply"?{reply:text,replyExternalId:`mock-reply-${row.id}`}:{hidden:true}),handledBy:actor.id,handledAt:new Date().toISOString(),mockAction:true}});
}
export async function syncChannelComments(now=new Date()){
  const db=createServiceSupabase(),since=new Date(now.getTime()-14*86400000).toISOString();
  const {data:posts,error}=await db.from("os_records").select("*").eq("record_type","content_publish").eq("status","published").is("archived_at",null).gte("metadata->>publishedAt",since).order("metadata->>publishedAt").limit(100);
  if(error)throw new ApiError(503,"COMMENT_COLLECTION_UNAVAILABLE","댓글 수집 준비가 필요합니다.");
  const counts={posts:0,comments:0,failures:0,truncated:(posts?.length??0)===100};
  for(const post of (posts??[]) as OsRecord[]){
    try{
      const account=post.metadata.account as {ownerId?:string;platform?:string}|undefined;
      if(!account?.ownerId||!["instagram","threads"].includes(account.platform??""))continue;
      const {data:connection,error:connectionError}=await db.from("os_meta_connections").select("*").eq("owner_id",account.ownerId).eq("platform",account.platform).maybeSingle();
      if(connectionError||!connection)throw Error("connection unavailable");
      const {data:owner}=await db.from("os_profiles").select("is_active").eq("id",account.ownerId).maybeSingle();if(!owner?.is_active)continue;
      assertMetaModeMatches(connection);
      if(Boolean(post.metadata.mockPublished)!==(metaMode()==="mock"))continue;
      const ids=Array.isArray(post.metadata.externalIds)?post.metadata.externalIds.filter((id):id is string=>typeof id==="string").slice(0,20):[];
      for(const externalId of ids){
        const result=await collectPostComments(connection as MetaConnection,externalId);counts.truncated ||= result.truncated;
        for(const comment of result.rows){
          const id=collectedCommentId(String(account.platform),account.ownerId,comment.externalId);
          const {data:inserted,error:writeError}=await db.from("os_records").upsert({id,record_type:"content_comment",title:comment.text.slice(0,200)||"댓글",description:comment.text,status:"unanswered",parent_id:post.id,owner_id:account.ownerId,created_by:account.ownerId,updated_by:account.ownerId,metadata:{postTitle:post.title,platform:account.platform,connectionOwnerId:account.ownerId,externalId:comment.externalId,author:comment.author,kind:"unclassified",topLevel:comment.topLevel,commentedAt:comment.createdAt,mock:metaMode()==="mock"}},{onConflict:"id",ignoreDuplicates:true}).select("id");
          if(writeError)throw Error("comment save failed");counts.comments+=inserted?.length??0;
        }
      }
      counts.posts++;
    }catch{counts.failures++;}
  }
  return counts;
}
