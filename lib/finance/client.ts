import { apiRequest } from "@/lib/api-client";
import { READ_RESOURCES, type FinanceData, type FinanceRow } from "./schema";
import { createLedgerProjection, workspaceFromLedger, type WorkspaceData } from "./ledger-adapter.mjs";

export async function connectFinance(getToken:()=>string|null,signal:AbortSignal) {
  let data:FinanceData={};
  const today=()=>new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Seoul"});
  const request=<T>(path:string,method="GET",body?:unknown)=>apiRequest<T>(`/api/v1/finance/${path}`,{token:getToken(),method,signal,body:body===undefined?undefined:JSON.stringify(body)});
  const load=async()=>{
    const next:FinanceData={};
    const resources=READ_RESOURCES.filter(r=>r!=="events");
    for(let i=0;i<resources.length;i+=4)await Promise.all(resources.slice(i,i+4).map(async resource=>{
      const rows:FinanceRow[]=[];
      for(let offset=0;offset<100000;offset+=1000){
        const page=await request<{rows:FinanceRow[];nextOffset:number|null}>(`workspace?resource=${resource}&offset=${offset}`);
        rows.push(...page.rows);if(page.nextOffset===null){next[resource]=rows;return;}
      }
      throw new Error("조회할 내역이 너무 많습니다. 관리자에게 기간별 보관을 요청해 주세요.");
    }));
    data=next;
  };
  await load();
  let projection=createLedgerProjection(data);
  const workspace=()=>workspaceFromLedger(data,today());
  const reload=async()=>{await load();projection=createLedgerProjection(data);return workspace();};
  const version=(resource:string,id:string)=>data[resource]?.find(r=>r.id===id)?.version;
  return {
    async findMapping(headers:string[],kind:string){
      const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(headers)));
      const signature=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,"0")).join("");
      return data.import_mappings.find(m=>m.kind===(kind==="cards"?"card":"bank")&&m.header_signature===signature)?.columns as Record<string,number>|undefined;
    },
    data:workspace(),today:today(),dataStart:workspace().settings?.data_start_date as string|undefined,
    async onChange(before:WorkspaceData,after:WorkspaceData){
      const changes=projection.diff(before,after);
      if(changes.length){
        const result=await request<{changes:{resource:string;row:FinanceRow}[]}>("batch","POST",{changes});
        projection.ack(result.changes);
      }
      return workspace();
    },
    async command(command:string,input:Record<string,unknown>={},file?:File){
      const id=String(input.id||"");
      if(command==="receipt-upload"&&file){
        const upload=await request<{path:string;token:string;mimeType:string}>("receipts/upload","POST",{transactionId:id,fileSize:file.size,mimeType:file.type});
        const {getBrowserSupabase}=await import("@/lib/supabase/client");
        const supabase=getBrowserSupabase();if(!supabase)throw new Error("영수증 저장소 연결이 필요합니다.");
        const {error}=await supabase.storage.from("finance-receipts").uploadToSignedUrl(upload.path,upload.token,file,{contentType:upload.mimeType,upsert:false});
        if(error)throw new Error("영수증 업로드에 실패했습니다. 다시 시도해 주세요.");
        await request(`receipts/${id}`,"PATCH",{version:version("card_transactions",id),path:upload.path});
      }else if(command==="receipt-remove")await request(`receipts/${id}`,"PATCH",{version:version("card_transactions",id),path:null});
      else if(command==="receipt-read"){
        const result=await request<{url:string}>(`receipts/${id}`);
        const link=document.createElement("a");link.href=result.url;link.target="_blank";link.rel="noopener noreferrer";link.click();
        return workspace();
      }else if(command==="refund-request")await request("refunds/request","POST",input);
      else if(["refund-approve","refund-retry","refund-reject"].includes(command))await request(`refunds/${command.slice(7)}`,"POST",{id,version:version("refund_requests",id)});
      else if(command==="bank-sync")await request("bank/sync","POST",input);
      else if(command==="memo-request"||command==="csv-export"){
        await request("events","POST",{kind:command==="memo-request"?"memo_request":"csv_export",view:command==="memo-request"?"cards":input.view,ids:input.ids||[]});return workspace();
      }
      else if(command!=="reload")throw new Error("지원하지 않는 재무 작업입니다.");
      return reload();
    },
    async importRows(kind:string,rows:Record<string,unknown>[],cards:Record<string,unknown>[],metadata:Record<string,unknown>){
      // Each chunk is one atomic transaction. A retry is safe through database uniqueness/CAS.
      try {
        for(let start=0;start<rows.length;start+=1000)await request("imports/commit","POST",{kind,rows:rows.slice(start,start+1000),cards,...metadata});
      }catch(error){
        await reload();
        throw new Error(`${error instanceof Error?error.message:"가져오기 실패"} 이미 저장된 묶음은 유지됩니다. 새로고침 후 같은 파일을 다시 올리면 중복 없이 이어갑니다.`);
      }
      return reload();
    },
  };
}
