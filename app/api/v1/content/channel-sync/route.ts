import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { safeSecretMatch } from "@/lib/server/auth";
import { syncChannelReminders } from "@/lib/server/channel-sync";
import { syncChannelComments } from "@/lib/server/channel-comments";
import { syncChannelMetrics } from "@/lib/server/channel-metrics";
import { readContentAutomationSettings } from "@/lib/server/content-automation-settings";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=120;
export async function GET(request:Request){
  try{
    const expected=process.env.CRON_SECRET??"",received=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")??"";
    if(!expected||!safeSecretMatch(received,expected))throw new ApiError(401,"INVALID_CRON_SECRET","예약 작업 인증에 실패했습니다.");
    if(process.env.CHANNEL_SYNC_ENABLED!=="true"||process.env.NEXT_PUBLIC_DEMO_MODE==="true")return NextResponse.json({enabled:false,reason:"채널 동기화는 DB 적용·환경 검수 후 별도로 활성화합니다."});
    const { settings } = await readContentAutomationSettings();
    const reminders=await syncChannelReminders(new Date(),settings.publishLeadMinutes);
    if (!settings.autoCollect) return NextResponse.json({
      enabled: true,
      autoCollect: false,
      ...reminders,
      comments: { skipped: true, reason: "자동 수집이 꺼져 있습니다." },
      metrics: { skipped: true, reason: "자동 수집이 꺼져 있습니다." },
    });
    const comments=await syncChannelComments(new Date(),settings.enabledChannels);
    const metrics=await syncChannelMetrics(new Date(),settings.enabledChannels);
    return NextResponse.json({enabled:true,autoCollect:true,...reminders,comments,metrics});
  }catch(error){return apiErrorResponse(error);}
}
