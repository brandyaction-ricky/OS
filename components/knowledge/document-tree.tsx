"use client";
import Link from "next/link";
import {useState,type DragEvent} from "react";
import type {KnowledgeDocument} from "@/lib/types";
import {documentHref,documentSpace,SPACE_LABELS,type Category} from "@/lib/knowledge/model";

const DRAG_TYPE="application/x-knowledge-document";
type MoveTarget={categoryId:string|null;parentId:string|null;space:"mine"|"team"};
type MoveDocument=(id:string,target:MoveTarget)=>Promise<void>;

function draggedId(event:DragEvent){return event.dataTransfer.getData(DRAG_TYPE);}
function allowsDrop(event:DragEvent){return event.dataTransfer.types.includes(DRAG_TYPE);}

function TreeBranch({rows,selected,space,categoryId,onMove,canDrag}:{rows:KnowledgeDocument[];selected:string;space:"mine"|"team"|"canon";categoryId:string|null;onMove?:MoveDocument;canDrag?:(doc:KnowledgeDocument)=>boolean}) {
  const [limit,setLimit]=useState(50),[collapsed,setCollapsed]=useState<Set<string>>(new Set()),[dropId,setDropId]=useState("");
  const ids=new Set(rows.map(row=>row.id));
  const roots=rows.filter(row=>!row.parent_document_id||!ids.has(row.parent_document_id));
  const children=new Map<string,KnowledgeDocument[]>();
  for(const row of rows)if(row.parent_document_id)children.set(row.parent_document_id,[...(children.get(row.parent_document_id)??[]),row]);
  const visible:{doc:KnowledgeDocument;depth:number}[]=[],visited=new Set<string>();
  const visit=(doc:KnowledgeDocument,depth:number)=>{
    if(visited.has(doc.id)||depth>63)return;
    visited.add(doc.id);visible.push({doc,depth});
    if(!collapsed.has(doc.id))for(const child of children.get(doc.id)??[])visit(child,depth+1);
  };
  for(const root of roots)visit(root,0);
  return <>{visible.slice(0,limit).map(({doc,depth})=><div className={`kw-tree-row${dropId===doc.id?" kw-tree-drop-target":""}`} key={doc.id} style={{paddingLeft:Math.min(depth,8)*12}}
    draggable={Boolean(canDrag?.(doc))}
    onDragStart={event=>{if(!canDrag?.(doc))return;event.dataTransfer.effectAllowed="move";event.dataTransfer.setData(DRAG_TYPE,doc.id);}}
    onDragEnd={()=>setDropId("")}
    onDragOver={event=>{if(space==="canon"||!onMove||!allowsDrop(event))return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect="move";setDropId(doc.id);}}
    onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDropId("");}}
    onDrop={event=>{if(space==="canon"||!onMove||!allowsDrop(event))return;event.preventDefault();event.stopPropagation();setDropId("");const id=draggedId(event);if(id&&id!==doc.id)void onMove(id,{categoryId,parentId:doc.id,space});}}>
    {children.has(doc.id)&&<button aria-label={`${doc.title} 하위 페이지 ${collapsed.has(doc.id)?"펼치기":"접기"}`} aria-expanded={!collapsed.has(doc.id)} onClick={()=>setCollapsed(current=>{const next=new Set(current);if(next.has(doc.id))next.delete(doc.id);else next.add(doc.id);return next;})}>{collapsed.has(doc.id)?"›":"⌄"}</button>}
    <Link aria-current={doc.id===selected?"page":undefined} href={documentHref(doc)}>{depth>0?"↳ ":""}{doc.title}</Link>
  </div>)}{visible.length>limit&&<button onClick={()=>setLimit(value=>value+50)}>50개 더 보기 ({visible.length-limit}개 남음)</button>}</>;
}

export function DocumentTree({documents,categories,selected,onMove,canDrag}:{documents:KnowledgeDocument[];categories:Category[];selected:string;onMove?:MoveDocument;canDrag?:(doc:KnowledgeDocument)=>boolean}) {
  const [dropGroup,setDropGroup]=useState("");
  return <aside className="kw-card kw-tree" aria-label="문서 파일 트리"><small>문서를 끌어 카테고리나 다른 문서에 놓아 이동할 수 있습니다.</small>{(["mine","team","canon"] as const).map(space=>{
    const rows=documents.filter(doc=>documentSpace(doc)===space);
    const groups=space==="canon"?[...new Set(rows.map(doc=>doc.folder||"미분류"))].map(folder=>({id:folder,name:folder,rows:rows.filter(doc=>(doc.folder||"미분류")===folder)})):[...categories.filter(category=>category.space===space).map(category=>({id:category.id,name:category.name,rows:rows.filter(doc=>doc.category_id===category.id)})),{id:"uncategorized",name:"미분류",rows:rows.filter(doc=>!categories.some(category=>category.id===doc.category_id))}];
    return <details key={space} open><summary>{SPACE_LABELS[space]} <small>{rows.length}</small></summary>{groups.map(group=><details key={group.id} className={`kw-tree-group${dropGroup===group.id?" kw-tree-drop-target":""}`} open>
      <summary onDragOver={event=>{if(space==="canon"||!onMove||!allowsDrop(event))return;event.preventDefault();event.dataTransfer.dropEffect="move";setDropGroup(group.id);}}
        onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDropGroup("");}}
        onDrop={event=>{if(space==="canon"||!onMove||!allowsDrop(event))return;event.preventDefault();event.stopPropagation();setDropGroup("");const id=draggedId(event);if(id)void onMove(id,{categoryId:group.id==="uncategorized"?null:group.id,parentId:null,space});}}>{group.name} <small>{group.rows.length}</small></summary>
      <TreeBranch rows={group.rows} selected={selected} space={space} categoryId={group.id==="uncategorized"?null:group.id} onMove={onMove} canDrag={canDrag}/>
    </details>)}</details>;
  })}</aside>;
}
