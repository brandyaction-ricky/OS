import { apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { assertHumanOwner } from "@/lib/server/content-automation-v07";
import { readRenderPcStatus } from "@/lib/server/youtube-render-pc";
import { createServiceSupabase } from "@/lib/supabase/server";
import { canUseYoutubeAutomationPilot } from "@/lib/youtube-automation-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request:Request){
  try {
    const actor=await authenticateRequest(request,{allowAgent:false});
    const owner=assertHumanOwner(actor);
    const db=createServiceSupabase();
    async function aiExecutor(gpt:boolean) {
      const jobs=()=> {
        const q=db.from("os_records").select("status,updated_at,metadata->doneAt,metadata->lease->>expiresAt")
          .eq("record_type","ai_job").eq("metadata->>kind","youtube_staff_ai_v1").eq("owner_id",owner).is("archived_at",null);
        return gpt ? q.eq("metadata->>executor","gpt") : q.or("metadata->>executor.is.null,metadata->>executor.eq.staff");
      };
      const [recent,ok]=await Promise.all([jobs().order("updated_at",{ascending:false}).limit(1).maybeSingle(),
        jobs().eq("status","done").order("updated_at",{ascending:false}).limit(1).maybeSingle()]);
      const row=recent.data;
      let state="실행 이력 없음";
      if(recent.error || ok.error) state="조회 실패";
      else if(row?.status==="active") state=Date.parse(String(row.expiresAt))>Date.now() ? "실행 중" : "오프라인 신호 · 작업 응답 만료";
      else if(row?.status==="blocked") state="최근 실행 실패";
      else if(row?.status==="backlog") state="작업 대기";
      else if(row?.status==="done") state="최근 실행 성공";
      return {label:gpt?"회사 GPT":"담당자의 AI",state,lastSuccess:typeof ok.data?.doneAt==="string"?ok.data.doneAt:null};
    }
    const [company,personal,pc]=await Promise.all([aiExecutor(true),aiExecutor(false),canUseYoutubeAutomationPilot(process.env)
      ? readRenderPcStatus().catch(()=>null) : null]);
    const actors=[company,personal,{label:"렌더 PC",state:!pc?"상태 미확인":pc.state==="unknown"?"등록 신호 없음":pc.state==="offline"?"오프라인":pc.lowDisk?"저장 공간 확인 필요":"실행 가능",lastSuccess:pc?.lastSuccessAt??null}];
    return Response.json({actors},{headers:{"Cache-Control":"private, no-store"}});
  } catch(error) {return apiErrorResponse(error);}
}
