"use client";

import { DEFAULT_SHORTFORM_BRIEF,type ShortformBrief } from "@/lib/shortform-production";
import { CostTag } from "@/components/cost-notice";

type Props={
  metadata:Record<string,unknown>;
  onChange:(metadata:Record<string,unknown>)=>void;
  onAppeals:()=>void;
};
export function ShortformProductionFields({metadata,onChange,onAppeals}:Props){
  const brief={...DEFAULT_SHORTFORM_BRIEF,...(metadata.shortformBrief as Partial<ShortformBrief>|undefined)};
  const set=(patch:Partial<ShortformBrief>)=>onChange({...metadata,
    shortformBrief:{...brief,...patch},
    // A new offer/audience must not silently carry the previous selected appeal.
    ...(Object.keys(patch).some(key=>!["appeal","assets","duration"].includes(key))
      ?{shortformAppeals:[],shortformBrief:{...brief,...patch,appeal:""}}:{}),
  });
  const appeals=Array.isArray(metadata.shortformAppeals)?metadata.shortformAppeals as {title:string;reason:string;evidence:string;basis:string}[]:[];
  return <div className="ca-v07-fields">
    <label>제작 방식<select value={brief.mode} onChange={event=>set({mode:event.target.value as ShortformBrief["mode"]})}>
      <option value="reuse">A · 롱폼 활용</option><option value="direct">B · 숏폼 직접 제작</option>
    </select></label>
    <label>영상 용도<select value={brief.purpose} onChange={event=>set({purpose:event.target.value as ShortformBrief["purpose"]})}>
      <option value="organic">일반 콘텐츠</option><option value="ad">광고 영상</option>
    </select></label>
    <label>완성 영상 길이<select value={brief.duration} onChange={event=>set({duration:Number(event.target.value) as ShortformBrief["duration"]})}>
      <option value={15}>15초</option><option value={30}>30초</option><option value={60}>60초</option>
    </select></label>
    <label>{brief.purpose==="ad"?"광고할 상품·서비스":"다룰 주제·상품"}<input value={brief.product} onChange={event=>set({product:event.target.value})}/></label>
    <label>대상 고객과 현재 상황<textarea rows={2} value={brief.audience} onChange={event=>set({audience:event.target.value})}/></label>
    <label>유도할 행동<input placeholder="예: 자세한 내용 보기, 상담 신청" value={brief.goal} onChange={event=>set({goal:event.target.value})}/></label>
    <label>연결할 페이지<input type="url" placeholder="https://" value={brief.landingUrl} onChange={event=>set({landingUrl:event.target.value})}/></label>
    <label>확인된 사실·근거와 출처<textarea rows={3} placeholder="현재 상품 정보, 사용이 허용된 후기, 실제 화면과 출처를 적어 주세요." value={brief.evidence} onChange={event=>set({evidence:event.target.value})}/></label>
    <label>사용할 소재와 미확보 소재<textarea rows={3} placeholder="실제 상품 사진, 서비스 화면, 촬영 영상 등을 구분해 적어 주세요." value={brief.assets} onChange={event=>set({assets:event.target.value})}/></label>
    {brief.purpose==="ad"?<>
      <div className="ca-v07-actions"><button type="button" onClick={onAppeals}>내 AI로 구매 이유 후보 받기</button><CostTag kind="ai"/></div>
      {appeals.map((appeal,index)=><div className="ca-v07-note" key={index}>
        <strong>{appeal.title} · {appeal.basis==="evidence"?"입력 근거 기반":"검증할 가설"}</strong>
        <p>{appeal.reason}</p><p>근거: {appeal.evidence||"추가 확인 필요"}</p>
        <button type="button" onClick={()=>set({appeal:`${appeal.title}\n${appeal.reason}\n근거: ${appeal.evidence}\n${appeal.basis==="evidence"?"입력 근거 기반":"검증할 가설"}`})}>이 구매 이유로 구성</button>
      </div>)}
      <label>선택한 구매 이유<textarea rows={3} value={brief.appeal} onChange={event=>set({appeal:event.target.value})}/></label>
      <p className="ca-v07-note">광고 문구와 실제 상품·연결 페이지의 약속을 함께 확인합니다. 후보 채택은 광고 집행 승인이 아닙니다.</p>
    </>:null}
    {brief.mode==="direct"?<p className="ca-v07-note">장면 시간은 완성 영상의 00:00부터 이어집니다. 내레이션·실제 소재·추가 촬영할 화면을 함께 준비합니다. 아래에서 장면별 이미지를 선택해 MP4를 만들거나 직접 제작한 MP4를 올릴 수 있습니다. 구성 변경 후에는 영상을 다시 확인해 주세요.</p>:null}
  </div>;
}

type Cut={start:string;end:string;text:string;note:string;voice?:string;asset?:string;missingAsset?:boolean};
export function ShortformCutEditor({value,onChange}:{value:string;onChange:(value:string)=>void}){
  let cuts:Cut[]|null=null;
  try{const parsed=JSON.parse(value);if(Array.isArray(parsed)&&parsed.every(cut=>cut&&typeof cut==="object"))cuts=parsed;}catch{}
  const change=(index:number,patch:Partial<Cut>)=>{
    if(cuts)onChange(JSON.stringify(cuts.map((cut,i)=>i===index?{...cut,...patch}:cut),null,2));
  };
  return <>
    {cuts?.map((cut,index)=><div className="ca-v07-note ca-v07-fields" key={index}>
      <strong>장면 {index+1}</strong>
      <label>시작 시간<input value={cut.start??""} onChange={event=>change(index,{start:event.target.value})}/></label>
      <label>끝 시간<input value={cut.end??""} onChange={event=>change(index,{end:event.target.value})}/></label>
      <label>자막<textarea rows={2} value={cut.text??""} onChange={event=>change(index,{text:event.target.value})}/></label>
      <label>화면 구성<textarea rows={2} value={cut.note??""} onChange={event=>change(index,{note:event.target.value})}/></label>
      {cut.voice!==undefined?<label>내레이션<textarea rows={2} value={cut.voice} onChange={event=>change(index,{voice:event.target.value})}/></label>:null}
      {cut.asset!==undefined?<label>사용할 소재<input value={cut.asset} onChange={event=>change(index,{asset:event.target.value})}/></label>:null}
      {cut.missingAsset!==undefined?<label><input type="checkbox" checked={cut.missingAsset} onChange={event=>change(index,{missingAsset:event.target.checked})}/>소재 확보 필요</label>:null}
    </div>)}
    <details><summary>컷 구성 직접 입력</summary><label>컷 구성(JSON)<textarea rows={6} value={value} onChange={event=>onChange(event.target.value)}/></label></details>
  </>;
}
