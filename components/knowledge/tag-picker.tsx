"use client";
import {useId,useState} from "react";
import {useKnowledge} from "./provider";

/** Suggestions are derived exclusively from the actor's readable document snapshot. */
export function TagPicker({value,onChange,disabled=false}:{value:string[];onChange:(tags:string[])=>void;disabled?:boolean}){
  const {state}=useKnowledge(),id=useId(),[query,setQuery]=useState("");
  const existing=[...new Set(state.documents.flatMap(d=>d.tags))].filter(tag=>!value.includes(tag)&&tag.toLowerCase().includes(query.toLowerCase())).sort().slice(0,12);
  function add(tag:string){const clean=tag.trim().slice(0,40);if(clean&&!value.includes(clean)&&value.length<30){onChange([...value,clean]);setQuery("");}}
  return <div className="kw-tag-picker">
    <label htmlFor={disabled?undefined:id}>태그</label>
    <div className="kw-actions">{value.map(tag=><button key={tag} type="button" disabled={disabled} aria-label={`${tag} 태그 삭제`} onClick={()=>onChange(value.filter(t=>t!==tag))}>{tag} ×</button>)}</div>
    {!disabled&&<>
      <div className="kw-actions">
        <input id={id} aria-label="태그 검색 또는 새 태그" maxLength={40} placeholder="태그 검색 또는 새 태그" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.nativeEvent.isComposing){e.preventDefault();add(query);}}}/>
        <button type="button" disabled={!query.trim()||value.length>=30} onClick={()=>add(query)}>추가</button>
      </div>
      {existing.length>0&&<div className="kw-actions" aria-label="기존 태그">{existing.map(tag=><button type="button" key={tag} onClick={()=>add(tag)}>{tag}</button>)}</div>}
    </>}
  </div>;
}
