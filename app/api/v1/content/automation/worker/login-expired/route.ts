import { NextResponse } from "next/server";
import { ApiError,apiErrorResponse } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { browserCookieKey,hashBrowserKey } from "@/lib/server/content-automation-v07";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function POST(request:Request){
  try{
    // This diagnostic cannot use a user token: the worker just discovered that its login is gone.
    const origin=request.headers.get("origin"),host=request.headers.get("host");
    if(!origin||!host||new URL(origin).host!==host)
      throw new ApiError(403,"ORIGIN_FORBIDDEN","같은 사이트에서 요청해 주세요.");
    const key=browserCookieKey(request);
    if(!/^[0-9a-f]{64}$/.test(key))throw new ApiError(401,"BROWSER_NOT_REGISTERED","등록되지 않은 브라우저입니다.");
    const {data,error}=await createServiceSupabase().from("os_ai_browsers")
      .update({login_expired_at:new Date().toISOString()})
      .eq("key_hash",hashBrowserKey(key)).is("removed_at",null)
      .select("id").maybeSingle();
    if(error)throw new ApiError(503,"BROWSER_CHECK_FAILED","로그인 상태를 기록하지 못했습니다.");
    if(!data)throw new ApiError(401,"BROWSER_NOT_REGISTERED","등록되지 않은 브라우저입니다.");
    return new NextResponse(null,{status:204,headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return apiErrorResponse(error);}
}
