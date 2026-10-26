import entries from './shortform-diagram-catalog.json';
export type SceneValue=string|number|boolean|SceneValue[]|{[key:string]:SceneValue};
export type FieldSpec={kind:string;fields?:Record<string,FieldSpec>;optional?:string[];item?:FieldSpec;min?:number;max?:number;time?:boolean;integer?:boolean;values?:string[]};
export interface DiagramEntry {type:string;name:string;slots:string;duration:number;scene:Record<string,SceneValue>;spec:FieldSpec}
export const DIAGRAM_CATALOG=entries as unknown as DiagramEntry[];
export const DIAGRAM_TYPES=DIAGRAM_CATALOG.map(row=>row.type) as [string,...string[]];
export function defaultDiagram(type:string,duration:number){
 const entry=DIAGRAM_CATALOG.find(row=>row.type===type);if(!entry)return undefined;
 let last=0;
 const times=(v:SceneValue,key='')=>{if(typeof v==='number'&&(key==='t'||key==='t0'||key.startsWith('t_')))last=Math.max(last,v);else if(v&&typeof v==='object')Object.entries(v).forEach(([k,x])=>times(x,k));};times(entry.scene);
 const scale=Math.min(duration/entry.duration,Math.max(.01,duration-.6)/Math.max(.01,last));
 const clone=(v:SceneValue,key=''):SceneValue=>typeof v==='number'&&(key==='t'||key==='t0'||key.startsWith('t_'))?Math.round(v*scale*100)/100:Array.isArray(v)?v.map(x=>clone(x)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clone(x,k)])):v;
 return {type,scene:clone(entry.scene) as Record<string,SceneValue>};
}
export function diagramProblem(type:string,scene:unknown):string|null{
 const entry=DIAGRAM_CATALOG.find(row=>row.type===type);if(!entry)return '지원하지 않는 도식입니다';
 function check(spec:FieldSpec,value:unknown,path:string):string|null{
  if(spec.kind==='object'){
   if(!value||typeof value!=='object'||Array.isArray(value))return path+' 입력을 확인해 주세요';
   const obj=value as Record<string,unknown>,fields=spec.fields??{};
   if(Object.keys(obj).some(k=>!Object.hasOwn(fields,k)&&!(path===''&&k==='theme')))return '허용되지 않은 도식 항목입니다';
   if(path===''&&obj.theme!==undefined&&!['myin','card'].includes(String(obj.theme)))return '톤을 확인해 주세요';
   for(const [key,child] of Object.entries(fields)){
    if(obj[key]===undefined&&(spec.optional?.includes(key)||['t0','cap','desc','when','t_on'].includes(key)))continue;
    const error=check(child,obj[key],path?path+'.'+key:key);if(error)return error;
   }
  }else if(spec.kind==='array'){
   if(!Array.isArray(value)||value.length<(spec.min??1)||value.length>(spec.max??6))return path+' 개수를 확인해 주세요';
   for(const [i,v]of value.entries()){const e=check(spec.item!,v,path+'.'+i);if(e)return e;}
  }else if(spec.kind==='number'){
   if(typeof value!=='number'||!Number.isFinite(value)||value<(spec.min??0)||value>(spec.max??1000)||(spec.integer&&!Number.isInteger(value)))return path+' 수치를 확인해 주세요';
  }else if(spec.kind==='boolean'){if(typeof value!=='boolean')return path+' 선택을 확인해 주세요';}
  else if(spec.kind==='enum'){if(typeof value!=='string'||!spec.values?.includes(value))return path+' 선택을 확인해 주세요';}
  else if(typeof value!=='string'||!value.trim()||value.length>(spec.max??8)||/[<>]/.test(value))return path+' 글자 수를 확인해 주세요';
  return null;
 }
 const error=check(entry.spec,scene,'');if(error)return error;
 const sc=scene as Record<string,unknown>;
 const list=sc.items??sc.options??sc.cells;
 if(typeof sc.pick==='number'&&(!Array.isArray(list)||sc.pick>=list.length))return '강조할 항목을 확인해 주세요';
 if(type==='lib_one_letter'&&String(sc.a).length!==String(sc.b).length)return '바꾸기 전후 글자 수를 같게 맞춰 주세요';
 return null;
}
