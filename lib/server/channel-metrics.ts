import { createHash } from "node:crypto";
import { ApiError } from "@/lib/http";
import { CHANNEL_METRICS,dueMetricSnapshot,parseChannelMetrics,type Snapshot } from "@/lib/channel-metrics";
import { createServiceSupabase } from "@/lib/supabase/server";
import { assertMetaModeMatches,metaMode,type MetaConnection } from "./meta-oauth";
import { metaRead } from "./meta-collection";
import type { OsRecord } from "@/lib/record-types";
export function channelMetricId(publicationId:string,platform:string,snapshot:Snapshot,metric:string){const hex=createHash("sha256").update(JSON.stringify(["api-channel-metric",publicationId,platform,snapshot,metric])).digest("hex");return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;}
export async function collectPostMetrics(connection:MetaConnection,externalId:string){
  assertMetaModeMatches(connection);
  if(metaMode()==="mock")return Object.fromEntries(CHANNEL_METRICS[connection.platform].map((metric,index)=>[metric,index===0?100:10]));
  const result=await metaRead(connection,`${encodeURIComponent(externalId)}/insights`,{metric:CHANNEL_METRICS[connection.platform].join(",")});
  return parseChannelMetrics(connection.platform,result.data??[]);
}
export async function syncChannelMetrics(now=new Date()){
  const db=createServiceSupabase(),since=new Date(now.getTime()-29*86400000).toISOString();
  const {data,error}=await db.from("os_records").select("*").eq("record_type","content_publish").eq("status","published").is("archived_at",null).gte("metadata->>publishedAt",since).order("metadata->>publishedAt").limit(200);
  if(error)throw new ApiError(503,"METRIC_COLLECTION_UNAVAILABLE","성과 수집 준비 상태를 확인해 주세요.");
  const counts={posts:0,metrics:0,missingMetrics:0,failures:0,truncated:(data?.length??0)===200};
  for(const post of (data??[]) as OsRecord[]){
    const snapshot=dueMetricSnapshot(String(post.metadata.publishedAt??""),now);if(!snapshot)continue;
    const account=post.metadata.account as {platform?:"instagram"|"threads";ownerId?:string}|undefined;
    if(!account?.ownerId||!account.platform||!(account.platform in CHANNEL_METRICS))continue;
    try{
      const {data:connection,error:connectionError}=await db.from("os_meta_connections").select("*").eq("owner_id",account.ownerId).eq("platform",account.platform).maybeSingle();
      if(connectionError||!connection)throw Error("missing connection");
      const {data:owner}=await db.from("os_profiles").select("is_active").eq("id",account.ownerId).maybeSingle();if(!owner?.is_active)continue;
      assertMetaModeMatches(connection);if(Boolean(post.metadata.mockPublished)!==(metaMode()==="mock"))continue;
      // A chain's parent/root post is the comparison unit. Replies are not
      // summed into root impressions, which would double-count a publication.
      const externalId=Array.isArray(post.metadata.externalIds)?post.metadata.externalIds[0]:null;
      if(typeof externalId!=="string")continue;
      const existing=await db.from("os_records").select("metadata").eq("record_type","content_metric").contains("metadata",{source:"api",publishId:post.id,snapshot});
      if(existing.error)throw Error("metric read failed");
      const saved=new Set((existing.data??[]).map(row=>row.metadata.metric));
      if(CHANNEL_METRICS[account.platform].every(metric=>saved.has(metric)))continue;
      const values=await collectPostMetrics(connection as MetaConnection,externalId);
      counts.missingMetrics+=CHANNEL_METRICS[account.platform].filter(metric=>values[metric]===undefined).length;
      for(const [metric,value] of Object.entries(values)){
        if(saved.has(metric))continue;
        const id=channelMetricId(post.id,account.platform,snapshot,metric);
        const {data:inserted,error:writeError}=await db.from("os_records").upsert({id,record_type:"content_metric",title:post.title,status:"done",parent_id:post.parent_id,owner_id:account.ownerId,created_by:account.ownerId,updated_by:account.ownerId,metric_current:value,metric_unit:metric,starts_at:now.toISOString(),metadata:{channelSnapshotVersion:1,source:"api",snapshot,platform:account.platform,platformFormat:post.metadata.platformFormat,publishId:post.id,contentId:post.id,metric,value,measuredAt:now.toISOString(),publishedAt:post.metadata.publishedAt,metricMode:"cumulative",dataSource:"Meta API",mock:metaMode()==="mock"}},{onConflict:"id",ignoreDuplicates:true}).select("id");
        if(writeError)throw Error("metric save failed");counts.metrics+=inserted?.length??0;
      }
      counts.posts++;
    }catch{counts.failures++;}
  }
  return counts;
}
