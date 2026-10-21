import {contentOrigin} from "./content-origin.ts";
type Topic = {id:string;record_type:string;title:string;archived_at?:string|null;metadata:Record<string,unknown>};
// 유튜브 공정 v1 projects live on their own screens (D3) and stay out of the legacy topic picker, except where the v1 menu
// itself sends people to an earlier screen (쇼츠 · 성과): there they are the videos to pick.
export function workTopics<T extends Topic>(records:T[],includeV1=false) {return records.filter(row=>row.record_type==="content_topic"&&!row.archived_at&&contentOrigin(row)==="own"&&(includeV1||row.metadata?.workflow!=="youtube_v1"));}
export function defaultsToAll(path:string,tab:string|null) {return ["/content/comments","/content/performance","/content/calendar"].includes(path)||(path==="/content/publishing"&&tab==="calendar");}
export function workTopicSelection<T extends Topic>(records:T[],requested:string|null,saved:string,all:boolean,includeV1=false) {
  const topics=workTopics(records,includeV1);
  if(requested!==null)return requested==="all"?"":topics.find(row=>row.id===requested)?.id??"";
  if(all)return "";
  return topics.find(row=>row.id===saved)?.id??topics[0]?.id??"";
}
export function workTopicHref(href:string,topic:string) {
  const [path,query]=href.split("?");const params=new URLSearchParams(query);
  params.set("topic",topic||"all");params.delete("sourceId");
  return `${path}?${params}`;
}
