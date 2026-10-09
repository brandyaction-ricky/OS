"use client";
import Link from "next/link";
import type {KnowledgeDocument} from "@/lib/types";
import type {KnowledgeGraph} from "@/lib/knowledge-links";
import {documentHref} from "@/lib/knowledge/model";

export function DocumentContext({document:doc, content, documents, graph, onVersions}:{document:KnowledgeDocument;content:string;documents:KnowledgeDocument[];graph:KnowledgeGraph|null;onVersions:()=>void}){
  let fenced=false;
  const headings=content.split("\n").flatMap(line=>{
    if(/^\s*(```|~~~)/.test(line)){fenced=!fenced;return [];}
    const match=!fenced&&line.match(/^(#{1,3})\s+(.+)$/);
    return match?[{level:match[1].length,title:match[2]}]:[];
  });
  const ids=new Set(graph?.edges.flatMap(edge=>edge.source===doc.id?[edge.target]:edge.target===doc.id?[edge.source]:[])??[]);
  const neighbors=documents.filter(row=>ids.has(row.id)&&row.status!=="archived").slice(0,8);
  function reveal(index:number){
    const root=window.document.querySelector(".kw-editor-card");
    const editable=root?.querySelector(".knowledge-rich-content");
    const target=editable?editable.querySelectorAll("h1,h2,h3")[index]:Array.from(root?.querySelectorAll(".markdown-section")??[])[index];
    if(target){if(target instanceof HTMLDetailsElement)target.open=true;target.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth",block:"center"});}
  }
  return <><hr/><h3>목차</h3><nav className="kw-outline" aria-label="편집 문서 목차">{headings.length?headings.map((heading,i)=><button key={`${i}:${heading.title}`} style={{paddingLeft:8+(heading.level-1)*8}} onClick={()=>reveal(i)}>{heading.title}</button>):<small>제목 블록이 없습니다</small>}</nav>
    <h3>주변 연결</h3><svg className="kw-neighborhood" viewBox="0 0 260 210" role="img" aria-label={`이 문서와 연결된 문서 ${neighbors.length}개`}>
      {neighbors.map((neighbor,i)=>{const angle=i*Math.PI*2/Math.max(1,neighbors.length),x=130+88*Math.cos(angle),y=105+75*Math.sin(angle);return <g key={neighbor.id}><line x1="130" y1="105" x2={x} y2={y}/><a href={documentHref(neighbor)}><title>{neighbor.title}</title><circle cx={x} cy={y} r="7"/><text x={x} y={y+19} textAnchor="middle">{neighbor.title.length>7?neighbor.title.slice(0,7)+"…":neighbor.title}</text></a></g>;})}
      <circle cx="130" cy="105" r="11"/><text x="130" y="130" textAnchor="middle">현재 문서</text>
    </svg><Link href={`/knowledge/graph?sel=${doc.id}`}>연결 지도 크게 보기</Link><button onClick={onVersions}>v{doc.current_version} · 버전 기록 보기</button></>;
}
