"use client";
import type { ShortformDiagram } from "@/lib/shortform-production";
export function ShortformDiagramFields({value,onChange,duration,disabled=false}:{value?:ShortformDiagram;onChange:(value?:ShortformDiagram)=>void;duration:number;disabled?:boolean}){
  const select=(type:string)=>{
    const d=Math.max(.1,duration),at=(fraction:number)=>Math.round(d*fraction*100)/100;
    if(type==="lib_timeline")onChange({type,scene:{t0:0,items:[{text:"",t:at(.1)},{text:"",t:at(.35)},{text:"",t:at(.6)}]}});
    else if(type==="lib_two_cards")onChange({type,scene:{t0:0,left:{text:"",t:at(.1)},right:{text:"",t:at(.5)}}});
    else if(type==="lib_iceberg")onChange({type,scene:{t0:0,top:{name:"",t:at(.1)},bottom:{name:"",t:at(.4)}}});
    else onChange(undefined);
  };
  const fields:(React.ReactNode)[]=[];
  if(value?.type==="lib_timeline")value.scene.items.forEach((item,index)=>fields.push(<div className="yp-row" key={index}>
    <label>시점 {index+1}<input className="yp-in" value={item.text} maxLength={6} disabled={disabled} onChange={e=>onChange({...value,scene:{...value.scene,items:value.scene.items.map((it,i)=>i===index?{...it,text:e.target.value}:it)}})}/></label>
    <label>등장(초)<input className="yp-in" type="number" min={0} max={Math.max(0,duration-.01)} step={.1} value={item.t} disabled={disabled} onChange={e=>onChange({...value,scene:{...value.scene,items:value.scene.items.map((it,i)=>i===index?{...it,t:Number(e.target.value)}:it)}})}/></label>
  </div>));
  if(value?.type==="lib_two_cards")(["left","right"] as const).forEach((side,index)=>fields.push(<div className="yp-row" key={side}>
    <label>{index===0?"위 카드":"아래 카드"}<input className="yp-in" value={value.scene[side].text} maxLength={8} disabled={disabled} onChange={e=>onChange({...value,scene:{...value.scene,[side]:{...value.scene[side],text:e.target.value}}})}/></label>
    <label>등장(초)<input className="yp-in" type="number" min={0} max={Math.max(0,duration-.01)} step={.1} value={value.scene[side].t} disabled={disabled} onChange={e=>onChange({...value,scene:{...value.scene,[side]:{...value.scene[side],t:Number(e.target.value)}}})}/></label>
  </div>));
  if(value?.type==="lib_iceberg")(["top","bottom"] as const).forEach(side=>fields.push(<div className="yp-row" key={side}>
    <label>{side==="top"?"수면 위":"수면 아래"}<input className="yp-in" value={value.scene[side].name} maxLength={8} disabled={disabled} onChange={e=>onChange({...value,scene:{...value.scene,[side]:{...value.scene[side],name:e.target.value}}})}/></label>
    <label>등장(초)<input className="yp-in" type="number" min={0} max={Math.max(0,duration-.01)} step={.1} value={value.scene[side].t} disabled={disabled} onChange={e=>onChange({...value,scene:{...value.scene,[side]:{...value.scene[side],t:Number(e.target.value)}}})}/></label>
  </div>));
  return <fieldset disabled={disabled} style={{border:0,padding:0,margin:0}}><label>화면 소재<select className="yp-in" aria-label="화면 소재" value={value?.type??"image"} onChange={e=>select(e.target.value)}>
    <option value="image">이미지</option><option value="lib_timeline">세로 타임라인</option><option value="lib_two_cards">위아래 비교</option><option value="lib_iceberg">빙산</option>
  </select></label>{fields}{value?<p className="yp-gq">등장 시각은 이 장면의 시작부터 셉니다. 내레이션에 맞춰 확인해 주세요. 도식은 세로 9:16으로 제작합니다.</p>:null}</fieldset>;
}
