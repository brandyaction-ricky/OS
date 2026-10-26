"use client";
import type { ShortformDiagram } from "@/lib/shortform-production";
import {DIAGRAM_CATALOG,defaultDiagram,diagramProblem,type FieldSpec,type SceneValue} from '@/lib/shortform-diagram-catalog';
const labels:Record<string,string>={a:'첫 번째',b:'두 번째',left:'위 카드',right:'아래 카드',top:'수면 위',bottom:'수면 아래',text:'문구',name:'이름',t:'등장(초)',t0:'시작(초)',items:'항목',options:'선택지',cells:'칸',marks:'눈금',outer:'바깥',lines:'대사',causes:'원인',hidden:'숨은 내용',targets:'대상',value:'값',at:'위치(0~1)',from:'시작 값(0~1)',to:'끝 값(0~1)',pick:'강조 항목(0부터)',max:'최댓값',copy:'핵심 문장',sub:'보조 문장',em:'강조 단어',cap:'작은 제목',desc:'설명',when:'시점',q:'질문',author:'출처',lead:'도입',key:'핵심',before:'이전',after:'이후',result:'결과',center:'중심',core:'중심',who:'말하는 사람',x:'가로축',y:'세로축',count:'횟수',label:'이름',keep:'남길 항목',state:'상태',heavy:'무거운 쪽',icon:'사물',a_icon:'첫 사물',b_icon:'둘째 사물',word:'완성 문구',button:'버튼',link:'연결 문구',me:'현재 위치',flat:'처음',jump:'변화',total:'합계',total_label:'합계 제목',title:'제목',t_strike:'지우기(초)',t_pick:'강조(초)',t_copy:'문장 등장(초)',t_on:'강조(초)'};
Object.assign(labels,{a_label:'첫 사물 이름',b_label:'둘째 사물 이름',back:'돌아오는 것',bad_label:'숨은 위험',base:'받침',big:'커진 결과',caption:'설명 문장',controller:'움직이는 원인',count_label:'횟수 설명',crack:'금 간 모습',end:'끝',frame:'벗어날 기준',fruit_label:'열매',good:'겉으로 좋은 것',mid:'공통점',no:'부정 표시',out:'벗어난 결과',puppet:'움직이는 대상',ratio:'크기 비교 문구',root_label:'뿌리',send:'보내는 것',sky_label:'위쪽 이름',small:'작은 시작',start:'시작',surface:'겉면',target:'대상',watcher:'지켜보는 것'});
const actions:Record<string,string>={a:'첫 문구',b:'다음 문구',break:'틀 깨기',click:'누르기',close:'닫기',crack:'금 가기',crown:'왕관',damage:'깨지기',done:'완성',draw:'선 그리기',drop:'떨어지기',fill:'채우기',find:'찾기',fuse:'합치기',gather:'모으기',grow:'커지기',hit:'충돌',link:'연결',melt:'녹기',move:'이동',not:'부정',open:'열기',peel:'벗기기',pull:'당기기',reveal:'드러내기',root:'뿌리 등장',run:'시간 흐름',send:'보내기',shrink:'작아지기',sky:'위에서 등장',split:'나누기',stack:'쌓기',swap:'바꾸기',tilt:'기울기',total:'합계 등장',write:'쓰기'};
function label(key:string){return labels[key]??(key.startsWith('t_')?`${actions[key.slice(2)]??"동작"}(초)`:key);}
export function ShortformDiagramFields({value,onChange,duration,disabled=false}:{value?:ShortformDiagram;onChange:(value?:ShortformDiagram)=>void;duration:number;disabled?:boolean}){
 const entry=DIAGRAM_CATALOG.find(row=>row.type===value?.type);
 const change=(path:(string|number)[],next:SceneValue)=>{
  if(!value)return;
  const scene=structuredClone(value.scene);let target=scene as Record<string,unknown>;
  for(const part of path.slice(0,-1))target=target[part] as Record<string,unknown>;
  target[path.at(-1)!]=next;
  const list=scene.items??scene.options??scene.cells;
  if(Array.isArray(list)&&typeof scene.pick==='number')scene.pick=Math.min(scene.pick,list.length-1);
  onChange({...value,scene});
 };
 function field(spec:FieldSpec,current:unknown,path:(string|number)[],title:string):React.ReactNode{
  if(spec.kind==='object')return <div key={path.join('.')} style={{display:'grid',gap:6,minWidth:0}}>{Object.entries(spec.fields??{}).filter(([key])=>key!=='t0').map(([key,s])=>{
   const child=(current as Record<string,unknown>|undefined)?.[key];
   const simple=['text','name'].includes(key);
   return field(s,child,[...path,key],simple?title:title?`${title} · ${label(key)}`:label(key));
  })}</div>;
  if(spec.kind==='array'){
   const list=(current??[]) as SceneValue[];
   return <fieldset key={path.join('.')} style={{border:'1px solid #5555',borderRadius:8,minWidth:0,padding:8}}><legend>{title}</legend>{list.map((item,index)=><div key={index} style={{marginBottom:10}}>{field(spec.item!,item,[...path,index],value?.type==='lib_timeline'?`시점 ${index+1}`:`${title} ${index+1}`)}
    {list.length>(spec.min??1)?<button type="button" className="yp-btn yp-sm" onClick={()=>change(path,list.filter((_,i)=>i!==index))}>항목 {index+1} 빼기</button>:null}</div>)}
    {list.length<(spec.max??6)?<button type="button" className="yp-btn yp-sm" onClick={()=>change(path,[...list,structuredClone(list.at(-1)!)] )}>항목 추가</button>:null}</fieldset>;
  }
  const id=path.join('.'),common={className:'yp-in','aria-label':title,disabled};
  if(spec.kind==='boolean')return <label key={id}>{title}<input type="checkbox" checked={Boolean(current)} disabled={disabled} onChange={e=>change(path,e.target.checked)}/></label>;
  if(spec.kind==='enum')return <label key={id}>{title}<select {...common} value={String(current??'')} onChange={e=>change(path,e.target.value)}>{spec.values?.map(v=><option key={v} value={v}>{({left:'위쪽',right:'아래쪽',full:'채워진 컵',broken:'깨진 컵',building:'건물',flame:'불꽃',cup:'컵',drop:'물방울'} as Record<string,string>)[v]??v}</option>)}</select></label>;
  if(spec.kind==='number')return <label key={id}>{title}<input {...common} type="number" min={spec.min} max={spec.time?Math.max(0,duration-.01):spec.max} step={spec.integer?1:.1} value={typeof current==='number'?current:0} onChange={e=>change(path,Number(e.target.value))}/></label>;
  return <label key={id}>{title}<input {...common} value={String(current??'')} maxLength={spec.max} onChange={e=>change(path,e.target.value)}/></label>;
 }
 const problem=value?diagramProblem(value.type,value.scene):null;
 return <fieldset disabled={disabled} style={{border:0,padding:0,margin:0,minWidth:0}}><label>화면 소재<select className="yp-in" aria-label="화면 소재" value={value?.type??'image'} onChange={e=>onChange(defaultDiagram(e.target.value,duration))}>
 <option value="image">이미지</option>{DIAGRAM_CATALOG.map(row=><option key={row.type} value={row.type}>{row.type==='lib_timeline'?'세로 타임라인':row.type==='lib_two_cards'?'위아래 비교':row.name}</option>)}</select></label>
 {entry&&value?<><p className="yp-gq">{entry.slots}</p>{field(entry.spec,value.scene,[],'')}{problem?<p role="status">{problem}</p>:null}<p className="yp-gq">예시 문구를 원고에 맞게 고쳐 주세요. 등장 시각은 장면 시작부터 셉니다. 세로 9:16으로 제작합니다.</p></>:null}</fieldset>;
}
