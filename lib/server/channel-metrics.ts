import { createHash } from "node:crypto";
import { ApiError } from "@/lib/http";
import { CHANNEL_METRICS,dueMetricSnapshot,parseChannelMetrics,type Snapshot } from "@/lib/channel-metrics";
import { createServiceSupabase } from "@/lib/supabase/server";
import { assertMetaModeMatches,loadMetaConnection,metaMode,type MetaConnection } from "./meta-oauth";
import { metaRead } from "./meta-collection";
import { YOUTUBE_ANALYTICS_SCOPE,type YoutubeStoredConnection } from "./youtube-oauth";
import type { OsRecord } from "@/lib/record-types";
export function channelMetricId(publicationId:string,platform:string,snapshot:Snapshot,metric:string){const hex=createHash("sha256").update(JSON.stringify(["api-channel-metric",publicationId,platform,snapshot,metric])).digest("hex");return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;}
export async function collectPostMetrics(connection:MetaConnection,externalId:string){
  assertMetaModeMatches(connection);
  if(metaMode()==="mock")return Object.fromEntries(CHANNEL_METRICS[connection.platform].map((metric,index)=>[metric,index===0?100:10]));
  const result=await metaRead(connection,`${encodeURIComponent(externalId)}/insights`,{metric:CHANNEL_METRICS[connection.platform].join(",")});
  return parseChannelMetrics(connection.platform,result.data??[]);
}

export function youtubeAnalyticsConnected(connection: Pick<YoutubeStoredConnection,"scope">){return connection.scope.split(/\s+/).includes(YOUTUBE_ANALYTICS_SCOPE);}

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
      // YouTube: every channel video is read day by day by syncChannelAnalytics (youtube-channel-analytics.ts), D1/D7/D28 included.
      if(providerPlatform==="youtube")continue;
      {
        const account=post.metadata.account as {platform?:"instagram"|"threads";ownerId?:string;accountKey?:string}|undefined;
        if(!account?.ownerId||!account.platform||!(account.platform in CHANNEL_METRICS)||!enabledPlatforms.includes(account.platform))continue;
        // 다채널 2단계: the account the post went out on; none = the owner's first, as before.
        const connection=await loadMetaConnection(account.ownerId,account.platform,account.accountKey).catch(()=>null);
        if(!connection)throw Error("missing connection");
        const {data:owner}=await db.from("os_profiles").select("is_active").eq("id",account.ownerId).maybeSingle();if(!owner?.is_active||post.metadata.space==="personal"&&post.owner_id!==account.ownerId)continue;
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
        const {data:inserted,error:writeError}=await db.from("os_records").upsert({id,record_type:"content_metric",title:post.title,status:"done",parent_id:post.metadata.space==="personal"?post.id:post.parent_id,owner_id:ownerId,created_by:ownerId,updated_by:ownerId,metric_current:value,metric_unit:metric,starts_at:now.toISOString(),metadata:{...(post.metadata.space==="personal"?{space:"personal"}:{}),channelSnapshotVersion:1,source:"api",snapshot,platform,platformFormat:post.metadata.platformFormat,publishId:post.id,contentId:post.id,metric,value,measuredAt:now.toISOString(),publishedAt,metricMode:"cumulative",dataSource,mock}},{onConflict:"id",ignoreDuplicates:true}).select("id");
        if(writeError)throw Error("metric save failed");counts.metrics+=inserted?.length??0;
      }
      counts.posts++;
    }catch(reason){if(reason instanceof ApiError&&reason.code==="YOUTUBE_ANALYTICS_SCOPE_REQUIRED")counts.reconnectRequired++;else counts.failures++;}
  }
  return counts;
}
