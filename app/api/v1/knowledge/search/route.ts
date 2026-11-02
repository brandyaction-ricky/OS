import {NextResponse} from "next/server";
import {ApiError,apiErrorResponse} from "@/lib/http";
import {authenticateRequest} from "@/lib/server/auth";
import {POLICY_FIELDS,readableKnowledgePages} from "@/lib/server/knowledge-page-access";
import {knowledgeAccessContext} from "@/lib/server/knowledge-access";
import {searchPrefilter,searchWorkspace} from "@/lib/knowledge/search";
import type {KnowledgeDocument} from "@/lib/types";
export const dynamic="force-dynamic";
export async function GET(request:Request){
  try{
    const actor=await authenticateRequest(request),url=new URL(request.url),q=(url.searchParams.get("q")??"").trim().slice(0,500);
    if(!q)return NextResponse.json({results:[],total:0});
    const policy=await knowledgeAccessContext(actor,[]);
    const options={space:url.searchParams.get("space")??"all",includeMine:url.searchParams.get("includeMine")==="true",includeAI:policy.actor.memberKind!=="partner"&&url.searchParams.get("includeAI")==="true",ownerId:actor.ownerId,titleOnly:url.searchParams.get("titleOnly")==="true"};
    // Only documents containing a searched word leave the database (all bodies were read and sent before: ~1 s of the 1.5 s).
    const prefilter=searchPrefilter(q);
    if(prefilter===null)return NextResponse.json({results:[],total:0});
    const documents:KnowledgeDocument[]=[],timing:string[]=[],started=performance.now();
    // Keep actor RLS in place without rescanning earlier pages on every request. Only what the search and the
    // access check read (bodies included): every column of every page made this 1.7 s on 2026-11-02.
    for(let cursor="00000000-0000-0000-0000-000000000000";;){
      let builder=actor.supabase.from("os_documents").select(`${POLICY_FIELDS},title,content_md,updated_at`).neq("status","archived").gt("id",cursor).order("id").limit(500);
      if(!options.includeMine)builder=builder.neq("status","draft");
      if(!options.includeAI)builder=builder.neq("source","mcp");
      const {data,error}=await (prefilter?builder.or(prefilter):builder);
      if(error)throw new ApiError(503,"KNOWLEDGE_SEARCH_UNAVAILABLE","문서 검색을 완료하지 못했습니다.");
      const rows=(data??[]) as KnowledgeDocument[];
      documents.push(...rows);
      if(rows.length<500)break;
      cursor=rows[rows.length-1].id;
    }
    const read=performance.now();timing.push(`documents;dur=${Math.round(read-started)}`);
    // One ancestor check over every page (parents on other pages are already loaded), not one per page.
    const allowed=await readableKnowledgePages(actor,documents),readable=documents.filter(d=>allowed.has(d.id));
    timing.push(`access;dur=${Math.round(performance.now()-read)}`);
    const results=searchWorkspace(readable,q,options),offset=Math.max(0,Number(url.searchParams.get("offset"))||0),limit=options.titleOnly?6:50;
    timing.push(`total;dur=${Math.round(performance.now()-started)}`);
    return NextResponse.json({results:results.slice(offset,offset+limit),total:results.length},{headers:{"Cache-Control":"private, no-store","Server-Timing":timing.join(", ")}});
  }catch(error){return apiErrorResponse(error);}
}
