import { ApiError } from "@/lib/http";
import { assertMetaModeMatches, metaAccessToken, metaMode, type MetaConnection } from "./meta-oauth";
import { uniqueComments, type CollectedComment } from "@/lib/content-comments";

export async function metaRead(connection:MetaConnection,path:string,fields:Record<string,string>){
  assertMetaModeMatches(connection);
  if(metaMode()!=="live")throw new ApiError(409,"META_READ_MODE","모의 연결은 실제 API를 호출하지 않습니다.");
  const version=process.env.META_INSTAGRAM_GRAPH_VERSION;
  if(connection.platform==="instagram"&&!/^v\d+\.\d+$/.test(version??""))throw new ApiError(503,"META_VERSION_REQUIRED","Instagram API 버전 검수가 필요합니다.");
  const host=connection.platform==="instagram"?`https://graph.instagram.com/${version}`:"https://graph.threads.net";
  const response=await fetch(`${host}/${path}?${new URLSearchParams(fields)}`,{headers:{authorization:`Bearer ${metaAccessToken(connection)}`},signal:AbortSignal.timeout(15000),cache:"no-store"});
  const body=await response.json().catch(()=>({}));
  if(!response.ok||body.error)throw new ApiError(502,"META_COLLECTION_FAILED","플랫폼 수집 권한·연결 상태를 확인해 주세요.");
  return body as {data?:Record<string,unknown>[];paging?:{cursors?:{after?:string};next?:string}};
}
export async function collectPostComments(connection:MetaConnection,externalId:string){
  assertMetaModeMatches(connection);
  if(metaMode()==="mock")return {rows:[{externalId:`mock-comment-${externalId}`,text:"이 내용을 실제 업무에 적용하는 첫 단계가 궁금해요.",author:"모의 시청자",topLevel:true,createdAt:new Date().toISOString()}],truncated:false};
  const instagram=connection.platform==="instagram",rows:CollectedComment[]=[];let after:string|undefined,truncated=false;
  for(let page=0;page<5;page++){
    const result=await metaRead(connection,`${encodeURIComponent(externalId)}/${instagram?"comments":"conversation"}`,{fields:instagram?"id,text,username,timestamp":"id,text,username,timestamp,replied_to",limit:"100",...(after?{after}: {})});
    for(const item of result.data??[]){if(typeof item.id!=="string")continue;rows.push({externalId:item.id,text:String(item.text??"").slice(0,20000),author:String(item.username??"시청자").slice(0,120),topLevel:instagram||(item.replied_to as {id?:string}|undefined)?.id===externalId,createdAt:typeof item.timestamp==="string"?item.timestamp:new Date().toISOString()});}
    after=result.paging?.next?result.paging?.cursors?.after:undefined;if(!after)break;truncated=page===4;
  }
  return {rows:uniqueComments(rows),truncated};
}
