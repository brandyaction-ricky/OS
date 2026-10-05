import { createHash } from "node:crypto";
import { ApiError } from "@/lib/http";
import { CHANNEL_METRICS,YOUTUBE_ANALYTICS_METRICS,dueMetricSnapshot,parseChannelMetrics,parseYoutubeAnalytics,type Snapshot } from "@/lib/channel-metrics";
import { createServiceSupabase } from "@/lib/supabase/server";
import { assertMetaModeMatches,metaMode,type MetaConnection } from "./meta-oauth";
import { metaRead } from "./meta-collection";
import { YOUTUBE_ANALYTICS_SCOPE,getYoutubeAccessToken,type YoutubeStoredConnection } from "./youtube-oauth";
import type { OsRecord } from "@/lib/record-types";
export function channelMetricId(publicationId:string,platform:string,snapshot:Snapshot,metric:string){const hex=createHash("sha256").update(JSON.stringify(["api-channel-metric",publicationId,platform,snapshot,metric])).digest("hex");return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;}
export async function collectPostMetrics(connection:MetaConnection,externalId:string){
  assertMetaModeMatches(connection);
  if(metaMode()==="mock")return Object.fromEntries(CHANNEL_METRICS[connection.platform].map((metric,index)=>[metric,index===0?100:10]));
  const result=await metaRead(connection,`${encodeURIComponent(externalId)}/insights`,{metric:CHANNEL_METRICS[connection.platform].join(",")});
  return parseChannelMetrics(connection.platform,result.data??[]);
}

export function youtubeAnalyticsConnected(connection: Pick<YoutubeStoredConnection,"scope">){return connection.scope.split(/\s+/).includes(YOUTUBE_ANALYTICS_SCOPE);}
export async function collectYoutubePostMetrics(connection:YoutubeStoredConnection,videoId:string,publishedAt:string,now=new Date()){
  if(!youtubeAnalyticsConnected(connection))throw new ApiError(409,"YOUTUBE_ANALYTICS_SCOPE_REQUIRED","성과 수집 권한을 추가하려면 YouTube 채널을 다시 연결해 주세요.");
  const accessToken=await getYoutubeAccessToken(connection.owner_id);
  const params=new URLSearchParams({ids:"channel==MINE",startDate:publishedAt.slice(0,10),endDate:now.toISOString().slice(0,10),metrics:YOUTUBE_ANALYTICS_METRICS.join(","),filters:`video==${videoId}`});
  const response=await fetch(`https://youtubeanalytics.googleapis.com/v2/reports?${params}`,{headers:{authorization:`Bearer ${accessToken}`},cache:"no-store",signal:AbortSignal.timeout(15000)});
  const body=await response.json().catch(()=>({})) as {columnHeaders?:Array<{name?:string}>;rows?:unknown[][];error?:{message?:string}};
  if(!response.ok)throw new ApiError(response.status===403?409:502,response.status===403?"YOUTUBE_ANALYTICS_SCOPE_REQUIRED":"YOUTUBE_ANALYTICS_FAILED",response.status===403?"YouTube 성과 권한을 확인하고 채널을 다시 연결해 주세요.":"YouTube 성과를 불러오지 못했습니다.",body.error?.message);
  return parseYoutubeAnalytics(body.columnHeaders,body.rows);
}
function youtubeMetricPlatform(post:OsRecord){const format=String(post.metadata.youtubeFormat??post.metadata.format??"").toLowerCase();return format.includes("short")||format.includes("쇼츠")?"yt_shorts":"yt_long";}

export async function syncChannelMetrics(now=new Date(),enabledPlatforms:readonly string[]=["youtube","instagram","threads"]){
  const db=createServiceSupabase(),since=now.getTime()-29*86400000;
  const {data,error}=await db.from("os_records").select("*").eq("record_type","content_publish").eq("status","published").is("archived_at",null).order("updated_at",{ascending:false}).limit(200);
  if(error)throw new ApiError(503,"METRIC_COLLECTION_UNAVAILABLE","성과 수집 준비 상태를 확인해 주세요.");
  const counts={posts:0,metrics:0,missingMetrics:0,reconnectRequired:0,failures:0,truncated:(data?.length??0)===200};
  for(const post of (data??[]) as OsRecord[]){
    const publishedAt=String(post.metadata.publishedAt??post.metadata.uploadedAt??""),publishedTime=Date.parse(publishedAt);
    if(!Number.isFinite(publishedTime)||publishedTime<since||publishedTime>now.getTime())continue;
    const snapshot=dueMetricSnapshot(publishedAt,now);if(!snapshot)continue;
    const providerPlatform=String(post.metadata.platform??"").toLowerCase();
    try{
      let values:Record<string,number>,metrics:readonly string[],platform:string,ownerId:string,dataSource:string,mock=false;
      if(providerPlatform==="youtube"){
        if(!enabledPlatforms.includes("youtube"))continue;
        const videoId=String(post.metadata.youtubeVideoId??""),channelId=String(post.metadata.channelId??"");
        if(!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)||!channelId)continue;
        const {data:connection,error:connectionError}=await db.from("os_youtube_connections").select("*").eq("channel_id",channelId).maybeSingle();
        if(connectionError||!connection)throw Error("missing youtube connection");
        const youtubeConnection=connection as YoutubeStoredConnection;
        if(!youtubeAnalyticsConnected(youtubeConnection)){counts.reconnectRequired++;continue;}
        const {data:owner}=await db.from("os_profiles").select("is_active").eq("id",youtubeConnection.owner_id).maybeSingle();if(!owner?.is_active)continue;
        values=await collectYoutubePostMetrics(youtubeConnection,videoId,publishedAt,now);metrics=YOUTUBE_ANALYTICS_METRICS;platform=youtubeMetricPlatform(post);ownerId=youtubeConnection.owner_id;dataSource="YouTube Analytics API";
      }else{
        const account=post.metadata.account as {platform?:"instagram"|"threads";ownerId?:string}|undefined;
        if(!account?.ownerId||!account.platform||!(account.platform in CHANNEL_METRICS)||!enabledPlatforms.includes(account.platform))continue;
        const {data:connection,error:connectionError}=await db.from("os_meta_connections").select("*").eq("owner_id",account.ownerId).eq("platform",account.platform).maybeSingle();
        if(connectionError||!connection)throw Error("missing connection");
        const {data:owner}=await db.from("os_profiles").select("is_active").eq("id",account.ownerId).maybeSingle();if(!owner?.is_active)continue;
        assertMetaModeMatches(connection);if(Boolean(post.metadata.mockPublished)!==(metaMode()==="mock"))continue;
        const externalId=Array.isArray(post.metadata.externalIds)?post.metadata.externalIds[0]:null;if(typeof externalId!=="string")continue;
        values=await collectPostMetrics(connection as MetaConnection,externalId);metrics=CHANNEL_METRICS[account.platform];platform=account.platform;ownerId=account.ownerId;dataSource="Meta API";mock=metaMode()==="mock";
      }
      const existing=await db.from("os_records").select("metadata").eq("record_type","content_metric").contains("metadata",{source:"api",publishId:post.id,snapshot});
      if(existing.error)throw Error("metric read failed");
      const saved=new Set((existing.data??[]).map(row=>row.metadata.metric));if(metrics.every(metric=>saved.has(metric)))continue;
      counts.missingMetrics+=metrics.filter(metric=>values[metric]===undefined).length;
      for(const [metric,value] of Object.entries(values)){
        if(saved.has(metric))continue;
        const id=channelMetricId(post.id,platform,snapshot,metric);
        const {data:inserted,error:writeError}=await db.from("os_records").upsert({id,record_type:"content_metric",title:post.title,status:"done",parent_id:post.parent_id,owner_id:ownerId,created_by:ownerId,updated_by:ownerId,metric_current:value,metric_unit:metric,starts_at:now.toISOString(),metadata:{channelSnapshotVersion:1,source:"api",snapshot,platform,platformFormat:post.metadata.platformFormat,publishId:post.id,contentId:post.id,metric,value,measuredAt:now.toISOString(),publishedAt,metricMode:"cumulative",dataSource,mock}},{onConflict:"id",ignoreDuplicates:true}).select("id");
        if(writeError)throw Error("metric save failed");counts.metrics+=inserted?.length??0;
      }
      counts.posts++;
    }catch(reason){if(reason instanceof ApiError&&reason.code==="YOUTUBE_ANALYTICS_SCOPE_REQUIRED")counts.reconnectRequired++;else counts.failures++;}
  }
  return counts;
}
