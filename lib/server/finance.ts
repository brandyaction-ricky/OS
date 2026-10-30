import { z } from "zod";
import { ApiError } from "@/lib/http";
import { authenticateRequest, type RequestActor } from "./auth";
import { READ_RESOURCES, resourceSchemas, batchSchema, type FinanceData, type FinanceRow, type Resource } from "@/lib/finance/schema";
import { validateLinks } from "@/lib/finance/domain.mjs";
import { STAFF_CARD_FIELDS, STAFF_FINANCE_WRITE } from "@/lib/finance/access";

const forbidden=()=>new ApiError(403,"FINANCE_FORBIDDEN","재무관리 권한이 없습니다.");
/** Any active member; `full` is finance access. Without it only the staff card screens open (STAFF_FINANCE_*). */
export async function financeMember(request:Request) {
  const actor=await authenticateRequest(request);
  const {data,error}=await actor.supabase.from("os_profiles").select("is_active,role,finance_access").eq("id",actor.id).single();
  if(error||!data?.is_active)throw forbidden();
  return {actor,full:data.role==="admin"||data.finance_access===true};
}
export async function financeActor(request:Request) {
  const {actor,full}=await financeMember(request);
  if(!full)throw forbidden();
  return actor;
}
export function financeDbError(error:{code?:string;message?:string}) :never {
  const code=error.message||"";
  if(code.includes("FINANCE_VERSION_CONFLICT")||error.code==="23505")throw new ApiError(409,"FINANCE_VERSION_CONFLICT","다른 사람이 먼저 고쳤거나 같은 항목이 있습니다. 새로 불러온 뒤 다시 저장해 주세요.");
  if(code.includes("FINANCE_STAFF_FIELDS"))throw new ApiError(403,"FINANCE_STAFF_FIELDS","카드 내역의 계정과목·사업·부가세·사용 목적·영수증만 고칠 수 있어요.");
  if(code.includes("FINANCE_SELF_APPROVAL"))throw new ApiError(403,"FINANCE_SELF_APPROVAL","요청자는 자신의 환불을 승인할 수 없습니다.");
  if(error.code==="42P01"||error.code==="PGRST205"||error.code==="PGRST202")throw new ApiError(503,"FINANCE_SETUP_REQUIRED","재무 데이터베이스 준비가 필요합니다. 승인된 개발 환경에서 마이그레이션을 먼저 확인해 주세요.");
  throw new ApiError(400,"FINANCE_SAVE_FAILED","저장하지 못했습니다. 입력 내용·연결 관계·최신 상태를 확인해 주세요.");
}
export async function readFinance(actor:RequestActor, resource:string, offset=0,limit=1000) {
  if(!(READ_RESOURCES as readonly string[]).includes(resource))throw new ApiError(404,"FINANCE_NOT_FOUND","지원하지 않는 재무 항목입니다.");
  const {data,error}=await actor.supabase.from(`os_fin_${resource}`).select("*").order("id").range(offset,offset+limit-1);
  if(error)financeDbError(error);
  // Provider raw data is never sent to a browser, even when sanitized at ingestion.
  return (data??[]).map(({raw,secret_env,...row})=>{void raw;void secret_env;return row as FinanceRow;});
}
export async function readLedger(actor:RequestActor,{maxBytes,only}:{maxBytes?:number;only?:readonly string[]}={}):Promise<FinanceData> {
  const data:FinanceData={};
  const resources=READ_RESOURCES.filter(x=>x!=="events"&&(!only||only.includes(x)));
  // The optional transport budget applies only to batch reads, never save validation.
  let bytes=maxBytes===undefined?0:Buffer.byteLength(JSON.stringify(Object.fromEntries(resources.map(resource=>[resource,[]]))),"utf8");
  const checkSize=()=>{if(maxBytes!==undefined&&bytes>maxBytes)throw new ApiError(413,"FINANCE_WORKSPACE_PAGED","장부를 나누어 불러옵니다.");};
  checkSize();
  let next=0,failed=false;
  // Reuse one authorized actor, without flooding the database with every table at once.
  await Promise.all(Array.from({length:Math.min(4,resources.length)},async()=>{
    while(!failed&&next<resources.length){
      const resource=resources[next++],rows:FinanceRow[]=[];
      try{
        for(let offset=0;;offset+=1000){
          if(failed)return;
          if(offset>=100000)throw new ApiError(413,"FINANCE_RANGE_REQUIRED","조회할 데이터가 많습니다. 기간을 줄여 주세요.");
          const page=await readFinance(actor,resource,offset);
          if(failed)return;
          if(maxBytes!==undefined){
            // Empty arrays are already included above; count only page contents and joins.
            bytes+=Buffer.byteLength(JSON.stringify(page),"utf8")-2+(rows.length&&page.length?1:0);
            checkSize();
          }
          rows.push(...page);
          if(page.length<1000){data[resource]=rows;break;}
        }
      }catch(error){failed=true;throw error;}
    }
  }));
  return data;
}
export async function commitFinance(actor:RequestActor,input:unknown,staff=false) {
  const body=batchSchema.parse(input);
  if(staff&&body.changes.some(change=>!STAFF_FINANCE_WRITE.includes(change.resource)))throw forbidden();
  const current=await readLedger(actor,staff?{only:STAFF_FINANCE_WRITE}:{}), next:FinanceData=structuredClone(current);
  const seen=new Set<string>();
  const changes=body.changes.map(change=>{
    if(!Object.hasOwn(resourceSchemas,change.resource))throw new ApiError(400,"FINANCE_READ_ONLY","변경할 수 없는 항목입니다.");
    const resource=change.resource as Resource;
    const row=resourceSchemas[resource].parse(change.row) as FinanceRow;
    const key=resource+":"+row.id;
    if(seen.has(key))throw new ApiError(400,"FINANCE_DUPLICATE_CHANGE","같은 항목을 중복 저장할 수 없습니다.");seen.add(key);
    const old=current[resource]?.find(x=>x.id===row.id);
    if((old?.version??0)!==row.version)throw new ApiError(409,"FINANCE_VERSION_CONFLICT","다른 사람이 먼저 고쳤습니다. 새로 불러온 뒤 다시 저장해 주세요.");
    if(resource==="card_transactions"&&row.receipt_path!== (old?.receipt_path??null))throw new ApiError(400,"FINANCE_RECEIPT_API_REQUIRED","영수증 첨부 화면을 이용해 주세요.");
    // Staff classify existing card uses only; amounts, dates and cards stay as imported (os_fin_before_write checks the same).
    if(staff&&resource==="card_transactions"&&(!old||Object.keys(row).some(key=>key!=="version"&&!STAFF_CARD_FIELDS.includes(key)&&JSON.stringify(row[key]??null)!==JSON.stringify(old[key]??null))))throw new ApiError(403,"FINANCE_STAFF_FIELDS","카드 내역의 계정과목·사업·부가세·사용 목적·영수증만 고칠 수 있어요.");
    next[resource]=[...(next[resource]??[]).filter(x=>x.id!==row.id),row];
    return {resource,row};
  });
  try{validateLinks(next);}catch(error){throw new ApiError(400,"FINANCE_INVALID_LINK",error instanceof Error?error.message:"연결 관계를 확인해 주세요.");}
  if((current.bank_accounts??[]).some(x=>!x.archived_at)&&!(next.bank_accounts??[]).some(x=>!x.archived_at))throw new ApiError(400,"FINANCE_LAST_ACCOUNT","마지막 통장은 보관할 수 없습니다.");
  const {data,error}=await actor.supabase.rpc("os_fin_commit",{p_changes:changes});
  if(error)financeDbError(error);
  return {changes:data};
}
/** Read the actual body with a hard ceiling; Content-Length alone is not trustworthy. */
export async function financeJson(request:Request) {
  const reader=request.body?.getReader(); if(!reader)throw new ApiError(400,"INVALID_JSON","입력 내용을 확인해 주세요.");
  let size=0;const chunks:Uint8Array[]=[];
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>3_500_000){await reader.cancel();throw new ApiError(413,"BODY_TOO_LARGE","한 번에 보내는 데이터가 너무 큽니다.");}chunks.push(value);}
  try{return JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{throw new ApiError(400,"INVALID_JSON","JSON 형식을 확인해 주세요.");}
}
export function financeError(error:unknown) {
  if(error instanceof z.ZodError)return new ApiError(400,"FINANCE_INVALID_INPUT","입력 내용의 형식·길이·금액을 확인해 주세요.");
  if(error instanceof ApiError)return error;
  // Never log payloads, credentials, filenames, PII or upstream error messages.
  console.error("finance request failed");
  return new ApiError(500,"FINANCE_INTERNAL_ERROR","재무 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
}
