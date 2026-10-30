import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { financeMember, financeDbError, financeError, financeJson, readFinance, readLedger, commitFinance } from "@/lib/server/finance";
import { STAFF_FINANCE_READ } from "@/lib/finance/access";
import { receiptUpload, receiptAttach, receiptRead } from "@/lib/server/finance-receipts";
import { refundCommand } from "@/lib/server/finance-refunds";
import { importFinance } from "@/lib/server/finance-imports";
import { READ_RESOURCES } from "@/lib/finance/schema";
import { budgetOf, overviewOf, payoutsOf } from "@/lib/finance/domain.mjs";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
type Context = { params:Promise<{path:string[]}> };
const aliases:Record<string,string>={"external-revenues":"external_revenues","bank-accounts":"bank_accounts","bank-transactions":"bank_transactions","bank-rules":"bank_rules","card-transactions":"card_transactions","card-rules":"card_rules","budget-items":"budget_items","budget-actuals":"budget_actuals","payout-notes":"payout_notes","recurring":"recurring_overrides","refunds":"refund_requests"};
const json=(value:unknown)=>NextResponse.json(value,{headers:{"Cache-Control":"private, no-store"}});
async function handle(request:Request,context:Context){
  try {
    const {actor,full}=await financeMember(request);
    // Without finance access only 카드지출·정기 결제 open: their rows, their two writes, receipts and their CSV log.
    const need=(ok:boolean)=>{if(!ok)throw new ApiError(403,"FINANCE_FORBIDDEN","재무관리 권한이 없습니다.");};
    const {path}=await context.params;
    const url=new URL(request.url), action=path.join("/");
    if(request.method==="GET"){
      if(action==="workspace"){
        if(url.searchParams.get("batch")==="1"){
          // Stop early for large ledgers and use the existing paged endpoint.
          const data=await readLedger(actor,{maxBytes:3_500_000,only:full?undefined:STAFF_FINANCE_READ});
          return json({data});
        }
        const resource=url.searchParams.get("resource")||"";
        const offset=z.coerce.number().int().min(0).max(100000).parse(url.searchParams.get("offset")||0);
        if(!full&&!STAFF_FINANCE_READ.includes(resource))return json({rows:[],nextOffset:null});
        const rows=await readFinance(actor,resource,offset);
        return json({rows,nextOffset:rows.length===1000?offset+1000:null});
      }
      if(path[0]==="receipts"&&path.length===2)return json(await receiptRead(actor,path[1]));
      if(action==="payouts"||action==="budget"||action==="overview"){
        need(full);
        const data=await readLedger(actor),today=new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Seoul"});
        const month=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(url.searchParams.get("month")||today.slice(0,7));
        const biz=z.enum(["all","edu","myin","hm","ba","common"]).parse(url.searchParams.get("biz")||"all");
        return json(action==="payouts"?{rows:payoutsOf(data,today).filter(p=>String(p.date).startsWith(month)&&(biz==="all"||p.biz===biz))}:action==="overview"?overviewOf(data,month,biz,today):budgetOf(data,month,biz,today));
      }
      const resource=aliases[path[0]]||path[0];
      if(!(READ_RESOURCES as readonly string[]).includes(resource))throw new ApiError(404,"FINANCE_NOT_FOUND","지원하지 않는 재무 항목입니다.");
      need(full||STAFF_FINANCE_READ.includes(resource));
      if(path.length===2){
        z.string().uuid().parse(path[1]);
        const {data,error}=await actor.supabase.from(`os_fin_${resource}`).select("*").eq("id",path[1]).maybeSingle();
        if(error)financeDbError(error);if(!data)throw new ApiError(404,"FINANCE_NOT_FOUND","항목을 찾지 못했습니다.");
        const {raw,secret_env,...row}=data;void raw;void secret_env;return json({row});
      }
      const offset=z.coerce.number().int().min(0).max(100000).parse(url.searchParams.get("offset")||0);
      return json({rows:await readFinance(actor,resource,offset)});
    }
    const body=await financeJson(request);
    if(request.method==="POST"&&action==="batch")return json(await commitFinance(actor,body,!full));
    if(request.method==="POST"&&action==="imports/commit"){need(full);return json(await importFinance(actor,body));}
    if(request.method==="POST"&&action==="events"){
      const action=z.object({kind:z.enum(["csv_export","memo_request"]),view:z.enum(["overview","sales","settlements","bank","cards","recurring","budget","tax_invoices","vat"]),ids:z.array(z.string().uuid()).max(1000).default([])}).strict().parse(body);
      need(full||action.view==="cards"||action.view==="recurring");
      const {error}=await actor.supabase.rpc("os_fin_log_action",{p_kind:action.kind,p_view:action.view,p_ids:action.ids});if(error)financeDbError(error);return json({recorded:true,mock:action.kind==="memo_request"});
    }
    if(request.method==="POST"&&action==="receipts/upload")return json(await receiptUpload(actor,body));
    if(request.method==="PATCH"&&path[0]==="receipts"&&path.length===2)return json(await receiptAttach(actor,path[1],body));
    if(request.method==="POST"&&path[0]==="refunds"&&path.length===2){need(full);return json(await refundCommand(actor,path[1],body));}
    if(action==="bank/sync")throw new ApiError(409,"FINANCE_BANK_NOT_CONFIGURED","은행 자동 연결은 아직 설정되지 않았습니다. 파일 가져오기를 이용해 주세요.");
    throw new ApiError(404,"FINANCE_NOT_FOUND","지원하지 않는 재무 요청입니다.");
  }catch(error){return apiErrorResponse(financeError(error));}
}
export const GET=handle;
export const POST=handle;
export const PATCH=handle;
