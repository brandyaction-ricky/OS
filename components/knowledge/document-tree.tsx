"use client";
import Link from "next/link";
import {useState} from "react";
import type {KnowledgeDocument} from "@/lib/types";
import {documentHref,documentSpace,SPACE_LABELS,type Category} from "@/lib/knowledge/model";

function TreeBranch({rows,selected}:{rows:KnowledgeDocument[];selected:string}) {
  const [limit,setLimit]=useState(50);
  const ids=new Set(rows.map(row=>row.id));
  const roots=rows.filter(row=>!row.parent_document_id||!ids.has(row.parent_document_id));
  const children=new Map<string,KnowledgeDocument[]>();
  for(const row of rows)if(row.parent_document_id)children.set(row.parent_document_id,[...(children.get(row.parent_document_id)??[]),row]);
  const visible:{doc:KnowledgeDocument;depth:number}[]=[],visited=new Set<string>();
  const visit=(doc:KnowledgeDocument,depth:number)=>{
    if(visited.has(doc.id)||depth>63)return;
    visited.add(doc.id);visible.push({doc,depth});
    for(const child of children.get(doc.id)??[])visit(child,depth+1);
  };
  for(const root of roots)visit(root,0);
  // Cycle-only rows are never silently linked into an invalid hierarchy.
  return <>{visible.slice(0,limit).map(({doc,depth})=><Link key={doc.id} style={{paddingLeft:8+Math.min(depth,8)*12}} aria-current={doc.id===selected?"page":undefined} href={documentHref(doc)}>{depth>0?"↳ ":""}{doc.title}</Link>)}{visible.length>limit&&<button onClick={()=>setLimit(value=>value+50)}>50개 더 보기 ({visible.length-limit}개 남음)</button>}</>;
}

export function DocumentTree({documents,categories,selected}:{documents:KnowledgeDocument[];categories:Category[];selected:string}) {
  return <aside className="kw-card kw-tree" aria-label="문서 파일 트리">{(["mine","team","canon"] as const).map(space=>{
    const rows=documents.filter(doc=>documentSpace(doc)===space);
    const groups=space==="canon"?[...new Set(rows.map(doc=>doc.folder||"미분류"))].map(folder=>({id:folder,name:folder,rows:rows.filter(doc=>(doc.folder||"미분류")===folder)})):[...categories.filter(category=>category.space===space).map(category=>({id:category.id,name:category.name,rows:rows.filter(doc=>doc.category_id===category.id)})),{id:"uncategorized",name:"미분류",rows:rows.filter(doc=>!categories.some(category=>category.id===doc.category_id))}];
    return <details key={space} open><summary>{SPACE_LABELS[space]} <small>{rows.length}</small></summary>{groups.filter(group=>group.rows.length).map(group=><details key={group.id} className="kw-tree-group" open><summary>{group.name} <small>{group.rows.length}</small></summary><TreeBranch rows={group.rows} selected={selected}/></details>)}</details>;
  })}</aside>;
}
