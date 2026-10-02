import type {OsRecord} from "./record-types";
export function validWorkDate(value: string) {
 const date=new Date(`${value}T00:00:00Z`);
 return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
/** Report partial failures so retry only resubmits records that did not save. */
export async function assignTaskBatch(tasks: OsRecord[], assigneeId: string, dueDate: string, update: (input:{id:string;expectedVersion:number;assigneeId:string;dueDate:string})=>Promise<unknown>) {
 if(!assigneeId||!validWorkDate(dueDate)||!tasks.length||tasks.length>20||new Set(tasks.map(task=>task.id)).size!==tasks.length)throw new Error("업무 1~20개와 담당자·기한을 확인해 주세요.");
 const result={updated:[] as string[],failed:[] as string[]};
 for(let offset=0;offset<tasks.length;offset+=4){
  const group=tasks.slice(offset,offset+4);
  const responses=await Promise.allSettled(group.map(task=>update({id:task.id,expectedVersion:task.version,assigneeId,dueDate})));
  responses.forEach((response,index)=>result[response.status==="fulfilled"?"updated":"failed"].push(group[index].id));
 }
 return result;
}
