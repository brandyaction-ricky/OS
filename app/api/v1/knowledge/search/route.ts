import {NextResponse} from "next/server";
import {ApiError,apiErrorResponse} from "@/lib/http";
import {authenticateRequest} from "@/lib/server/auth";
import {readableKnowledgePages} from "@/lib/server/knowledge-page-access";
import {knowledgeAccessContext} from "@/lib/server/knowledge-access";
import {searchWorkspace} from "@/lib/knowledge/search";
import type {KnowledgeDocument} from "@/lib/types";
export const dynamic="force-dynamic";
export async function GET(request:Request){
  try{
    const actor=await authenticateRequest(request),url=new URL(request.url),q=(url.searchParams.get("q")??"").trim().slice(0,500);
    if(!q)return NextResponse.json({results:[],total:0});
    const policy=await knowledgeAccessContext(actor,[]);
    const options={space:url.searchParams.get("space")??"all",includeMine:url.searchParams.get("includeMine")==="true",includeAI:policy.actor.memberKind!=="partner"&&url.searchParams.get("includeAI")==="true",ownerId:actor.ownerId,titleOnly:url.searchParams.get("titleOnly")==="true"};
    const documents:KnowledgeDocument[]=[];
    for(let offset=0;;offset+=500){
      let builder=actor.supabase.from("os_documents").select("*").neq("status","archived").order("id").range(offset,offset+499);
      if(!options.includeMine)builder=builder.neq("status","draft");
      if(!options.includeAI)builder=builder.neq("source","mcp");
      const {data,error}=await builder;
      if(error)throw new ApiError(503,"KNOWLEDGE_SEARCH_UNAVAILABLE","문서 검색을 완료하지 못했습니다.");
      const rows=(data??[]) as KnowledgeDocument[],allowed=await readableKnowledgePages(actor,rows);
      documents.push(...rows.filter(d=>allowed.has(d.id)));
      if(rows.length<500)break;
    }
    const results=searchWorkspace(documents,q,options),offset=Math.max(0,Number(url.searchParams.get("offset"))||0),limit=options.titleOnly?6:50;
    return NextResponse.json({results:results.slice(offset,offset+limit),total:results.length},{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return apiErrorResponse(error);}
}
