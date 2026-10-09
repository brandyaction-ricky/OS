import type { KnowledgeDocument } from "../types";
import { documentSpace,type Space } from "./model.ts";
const GROUPS=[["쇼츠","숏츠","쇼트","shorts"],["썸네일","섬네일","thumbnail"],["회의","회의록","meeting"],["수강생","학생","회원"],["정본","기준"]];
export interface KnowledgeSearchHit {id:string;title:string;space:Space;group:"title"|"body"|"partial";excerpt:string;hits:number;updatedAt:string}
export function queryTerms(query:string){return query.toLowerCase().trim().split(/\s+/).filter(Boolean).map(word=>GROUPS.find(group=>group.includes(word))??[word]);}
export function plainMarkdown(value:string){return value.replace(/!\[[^\]]*\]\([^)]*\)/g,"").replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").replace(/[#*_>|]/g,"").replace(/\s+/g," ").trim();}
export function searchWorkspace(documents:KnowledgeDocument[],query:string,{space="all",includeMine=false,includeAI=false,ownerId="",titleOnly=false}:{space?:string;includeMine?:boolean;includeAI?:boolean;ownerId?:string;titleOnly?:boolean}={}):KnowledgeSearchHit[]{
  const terms=queryTerms(query.replace(/결정/g,"").trim());if(!terms.length)return [];
  return documents.filter(d=>d.status!=="archived").flatMap(d=>{
    const s=documentSpace(d);
    if((space!=="all"&&space!==s)||(s==="mine"&&(!includeMine||d.owner_id!==ownerId))||(s==="ai"&&!includeAI))return [];
    const title=d.title.toLowerCase(),body=plainMarkdown(d.content_md),lower=body.toLowerCase();
    const titleMatches=terms.filter(words=>words.some(word=>title.includes(word))).length;
    const matches=terms.filter(words=>words.some(word=>title.includes(word)||lower.includes(word))).length;
    if(!matches||(titleOnly&&titleMatches!==terms.length))return [];
    const group=titleMatches===terms.length?"title":matches===terms.length?"body":"partial";
    const first=terms.flat().map(term=>lower.indexOf(term)).filter(index=>index>=0).sort((a,b)=>a-b)[0]??0;
    return [{id:d.id,title:d.title,space:s,group,excerpt:body.slice(Math.max(0,first-45),first+180),hits:matches+titleMatches*4,updatedAt:d.updated_at} as KnowledgeSearchHit];
  }).sort((a,b)=>["title","body","partial"].indexOf(a.group)-["title","body","partial"].indexOf(b.group)||b.hits-a.hits||b.updatedAt.localeCompare(a.updatedAt));
}
