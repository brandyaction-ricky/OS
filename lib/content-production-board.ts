import {contentOrigin,type ContentOriginFilter} from "./content-origin.ts";
import type {OsRecord} from "./record-types";
export const PRODUCTION_STEPS=[["planning","기획"],["script","원고"],["package","제목·썸네일"],["short","숏폼"],["publish","발행"]] as const;
export type ProductionStep=typeof PRODUCTION_STEPS[number][0];
export function productionStep(source:OsRecord, children:OsRecord[]):ProductionStep {
 const linked=children.filter(row=>!row.archived_at&&row.parent_id===source.id&&contentOrigin(row)!=="test");
 const has=(type:string,kind?:string)=>linked.some(row=>row.record_type===type&&(!kind||row.metadata.packageKind===kind));
 if(source.status==="published"||linked.some(row=>row.record_type==="content_publish"&&row.status==="published"))return "publish";
 if(!has("content_package","topic_plan")&&source.status!=="planned")return "planning";
 if(!has("content_script"))return "script";
 if(!has("content_package","title_package"))return "package";
 if(!has("content_short")&&source.metadata.skipShorts!==true)return "short";
 return "publish";
}
export function productionSources(records:OsRecord[],origin:ContentOriginFilter="own") {
 return records.filter(row=>row.record_type==="content_topic"&&!row.archived_at&&(origin==="all"||contentOrigin(row)===origin));
}
export function productionHref(sourceId:string,step:ProductionStep="planning") {return `/content/production?${new URLSearchParams({sourceId,step})}`;}
