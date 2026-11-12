import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/http";
import { metaConnectionFailure } from "@/lib/meta-connection-result";
import { META_COOKIE, metaMode, saveMetaConnection, verifyMetaState } from "@/lib/server/meta-oauth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url), jar = await cookies();
  const base = process.env.OS_PUBLIC_URL?.replace(/\/$/, "");
  if (!base) return NextResponse.json({ error: "연결 결과를 돌려보낼 OS 주소가 없습니다." }, { status: 503 });
  let result = "failed";
  try {
    const state = verifyMetaState(jar.get(META_COOKIE)?.value, url.searchParams.get("state"));
    if (metaMode() !== "live") throw new ApiError(503, "META_MODE_NOT_LIVE", "Meta 실제 연결 모드가 아닙니다.");
    if (url.searchParams.has("error")) throw new ApiError(403, "META_PROVIDER_DENIED", "Meta 동의가 완료되지 않았습니다.");
    const code = url.searchParams.get("code");
    if (!code) throw new ApiError(400, "META_CODE_REQUIRED", "연결 코드가 없습니다.");
    await saveMetaConnection(state.ownerId, state.platform, code); result = "connected";
  } catch (error) {
    const failure = metaConnectionFailure(error);
    result = failure.result;
    // Only allowlisted codes/stages/numbers. Never log the raw error, request, URL or provider body.
    console.warn("Meta OAuth connection failed", failure.diagnostic);
  }
  const response = NextResponse.redirect(`${base}/settings/account?meta=${result}`);
  response.cookies.set(META_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/api/v1/meta", maxAge: 0 });
  return response;
}
