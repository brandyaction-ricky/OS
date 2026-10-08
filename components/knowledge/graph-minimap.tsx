"use client";
import type {Point} from "@/lib/knowledge/force";
import type {KnowledgeGraphNode} from "@/lib/knowledge-links";
export function GraphMinimap({positions,nodes,view,bounds,move}:{positions:Map<string,Point>;nodes:KnowledgeGraphNode[];view:{x:number;y:number;k:number};bounds:{width:number;height:number};frame:number;move:(x:number,y:number)=>void}){
 const points=nodes.map(n=>positions.get(n.id)).filter((p):p is Point=>Boolean(p));if(!points.length)return null;
 const minX=Math.min(...points.map(p=>p.x))-50,maxX=Math.max(...points.map(p=>p.x))+50,minY=Math.min(...points.map(p=>p.y))-50,maxY=Math.max(...points.map(p=>p.y))+50;
 const w=maxX-minX,h=maxY-minY;
 return <svg className="kw-minimap" viewBox={`${minX} ${minY} ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="연결 미니맵. 누른 위치로 이동" onPointerDown={e=>{e.stopPropagation();const rect=e.currentTarget.getBoundingClientRect();move(minX+(e.clientX-rect.left)/rect.width*w,minY+(e.clientY-rect.top)/rect.height*h);}} onPointerMove={e=>e.stopPropagation()} onPointerUp={e=>e.stopPropagation()}>
  {nodes.map(n=>{const p=positions.get(n.id);return p?<circle key={n.id} cx={p.x} cy={p.y} r={Math.max(w/90,4)} fill={n.space==="canon"?"#4da575":n.space==="mine"?"#9471d9":n.space==="meet"?"#d788a9":"#508bd7"}/>:null;})}
  <rect x={(-view.x-bounds.width/2)/view.k} y={(-view.y-bounds.height/2)/view.k} width={bounds.width/view.k} height={bounds.height/view.k} fill="none" stroke="currentColor" strokeWidth={Math.max(w/80,2)}/>
 </svg>;
}
