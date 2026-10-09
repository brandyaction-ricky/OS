import { diffMarkdownLines } from "../line-diff.ts";
export interface MergePart { id:string; conflict:boolean; base:string; current:string; proposed:string; value:string; valueLines:number; currentLines:number; proposedLines:number }
interface Hunk { start:number; end:number; lines:string[] }
function hunks(base:string,next:string):Hunk[] {
  const result:Hunk[]=[];let cursor=0,active:Hunk|null=null;
  for(const line of diffMarkdownLines(base,next)){
    if(line.kind==="same"){if(active){result.push(active);active=null;}cursor++;continue;}
    active??={start:cursor,end:cursor,lines:[]};
    if(line.kind==="removed"){cursor++;active.end=cursor;}else active.lines.push(line.text);
  }
  if(active)result.push(active);return result;
}
/** Diff3 over base-coordinate edit spans; insertions are not matched by shifted line numbers. */
export function mergeMarkdown(base:string,current:string,proposed:string):MergePart[]{
  if(current===proposed||current===base||proposed===base){const value=current===base?proposed:current;return [{id:"0",conflict:false,base,current,proposed,value,valueLines:value.split("\n").length,currentLines:current.split("\n").length,proposedLines:proposed.split("\n").length}];}
  const lines=base.split("\n"),left=hunks(base,current),right=hunks(base,proposed);
  const changes=[...left.map(h=>({...h,side:"current" as const})),...right.map(h=>({...h,side:"proposed" as const}))].sort((a,b)=>a.start-b.start||a.end-b.end);
  const result:MergePart[]=[];let cursor=0,index=0;
  function push(bl:string[],cl:string[],pl:string[]){const b=bl.join("\n"),c=cl.join("\n"),p=pl.join("\n"),same=(a:string[],z:string[])=>JSON.stringify(a)===JSON.stringify(z);result.push({id:String(result.length),conflict:!same(cl,pl)&&!same(cl,bl)&&!same(pl,bl),base:b,current:c,proposed:p,value:same(cl,bl)?p:c,valueLines:same(cl,bl)?pl.length:cl.length,currentLines:cl.length,proposedLines:pl.length});}
  while(index<changes.length){
    const first=changes[index++];let end=first.end;const group=[first];
    while(index<changes.length&&(changes[index].start<end||(changes[index].start===end&&(end===first.start||changes[index].start===changes[index].end)))){
      const next=changes[index++];group.push(next);end=Math.max(end,next.end);
    }
    if(cursor<first.start){const same=lines.slice(cursor,first.start);push(same,same,same);}
    const render=(side:"current"|"proposed")=>{let pos=first.start;const output:string[]=[];for(const h of group.filter(h=>h.side===side).sort((a,b)=>a.start-b.start)){output.push(...lines.slice(pos,h.start),...h.lines);pos=h.end;}output.push(...lines.slice(pos,end));return output;};
    push(lines.slice(first.start,end),render("current"),render("proposed"));cursor=end;
  }
  if(cursor<lines.length){const same=lines.slice(cursor);push(same,same,same);}
  return result;
}
export function joinMergeParts(parts:MergePart[]){return parts.flatMap(part=>part.valueLines===0?[]:part.value.split("\n")).join("\n");}
export function mergeValue<T>(base:T,current:T,proposed:T){const equal=(a:T,b:T)=>JSON.stringify(a)===JSON.stringify(b);return {conflict:!equal(current,proposed)&&!equal(base,current)&&!equal(base,proposed),value:equal(base,current)?proposed:current};}
