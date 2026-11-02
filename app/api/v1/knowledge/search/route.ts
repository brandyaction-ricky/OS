import {NextResponse} from "next/server";
import {ApiError,apiErrorResponse} from "@/lib/http";
import {authenticateRequest} from "@/lib/server/auth";
import {POLICY_FIELDS,readableKnowledgePages} from "@/lib/server/knowledge-page-access";
import {knowledgeAccessContext} from "@/lib/server/knowledge-access";
import {searchText,searchWorkspace,type SearchText} from "@/lib/knowledge/search";
import type {KnowledgeDocument} from "@/lib/types";
export const dynamic="force-dynamic";
// 문서 찾기 reads every visible body. A warm instance keeps them per document and content_hash (the os_documents write trigger
// refreshes it on every save) and reads only new or changed bodies — the same idea as the 연결 map's links (#438). Bodies are
// kept already cleaned for search, so a search does not clean every body again.
// ponytail: per-instance memory (every visible body twice, ~45 MB at most); a database text index if cold starts matter.
const bodyCache=new Map<string,{hash:string;text:SearchText}>();
export async function GET(request:Request){
  try{
    const actor=await authenticateRequest(request),url=new URL(request.url),q=(url.searchParams.get("q")??"").trim().slice(0,500);
    if(!q)return NextResponse.json({results:[],total:0});
    const policy=await knowledgeAccessContext(actor,[]);
    const options={space:url.searchParams.get("space")??"all",includeMine:url.searchParams.get("includeMine")==="true",includeAI:policy.actor.memberKind!=="partner"&&url.searchParams.get("includeAI")==="true",ownerId:actor.ownerId,titleOnly:url.searchParams.get("titleOnly")==="true"};
    const documents:KnowledgeDocument[]=[],timing:string[]=[],started=performance.now();
    // Keep actor RLS in place without rescanning earlier pages on every request. Light columns first (policy fields, title,
    // time and body fingerprint); the bodies come after the access check, from the cache when unchanged.
    for(let cursor="00000000-0000-0000-0000-000000000000";;){
      let builder=actor.supabase.from("os_documents").select(`${POLICY_FIELDS},title,updated_at,content_hash`).neq("status","archived").gt("id",cursor).order("id").limit(500);
      if(!options.includeMine)builder=builder.neq("status","draft");
      if(!options.includeAI)builder=builder.neq("source","mcp");
      const {data,error}=await builder;
      if(error)throw new ApiError(503,"KNOWLEDGE_SEARCH_UNAVAILABLE","문서 검색을 완료하지 못했습니다.");
      const rows=(data??[]) as unknown as KnowledgeDocument[];
      documents.push(...rows);
      if(rows.length<500)break;
      cursor=rows[rows.length-1].id;
    }
    const read=performance.now();timing.push(`documents;dur=${Math.round(read-started)}`);
    // One ancestor check over every page (parents on other pages are already loaded), not one per page.
    const allowed=await readableKnowledgePages(actor,documents),readable=documents.filter(d=>allowed.has(d.id));
    const checked=performance.now();timing.push(`access;dur=${Math.round(checked-read)}`);
    const hashOf=(d:KnowledgeDocument)=>(d as KnowledgeDocument&{content_hash?:string|null}).content_hash??"";
    const stale=readable.filter(d=>!hashOf(d)||bodyCache.get(d.id)?.hash!==hashOf(d)).map(d=>d.id);
    const chunks=Array.from({length:Math.ceil(stale.length/200)},(_,i)=>stale.slice(i*200,i*200+200));
    for(let i=0;i<chunks.length;i+=4){
      const pages=await Promise.all(chunks.slice(i,i+4).map(chunk=>actor.supabase.from("os_documents").select("id,content_md,content_hash").in("id",chunk)));
      for(const page of pages){
        if(page.error)throw new ApiError(503,"KNOWLEDGE_SEARCH_UNAVAILABLE","문서 검색을 완료하지 못했습니다.");
        for(const row of (page.data??[]) as {id:string;content_md:string|null;content_hash:string|null}[])bodyCache.set(row.id,{hash:row.content_hash??"",text:searchText(row.content_md??"")});
      }
    }
    timing.push(`stale;desc="${stale.length}/${readable.length}"`,`bodies;dur=${Math.round(performance.now()-checked)}`);
    const results=searchWorkspace(readable,q,{...options,text:d=>bodyCache.get(d.id)?.text??{body:"",lower:""}}),offset=Math.max(0,Number(url.searchParams.get("offset"))||0),limit=options.titleOnly?6:50;
    timing.push(`total;dur=${Math.round(performance.now()-started)}`);
    return NextResponse.json({results:results.slice(offset,offset+limit),total:results.length},{headers:{"Cache-Control":"private, no-store","Server-Timing":timing.join(", ")}});
  }catch(error){return apiErrorResponse(error);}
}
