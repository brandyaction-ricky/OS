import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/http";
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
    if (metaMode() !== "live" || url.searchParams.has("error")) result = "tester_or_permission_required";
    else {
      const code = url.searchParams.get("code");
      if (!code) throw new ApiError(400, "META_CODE_REQUIRED", "연결 코드가 없습니다.");
      await saveMetaConnection(state.ownerId, state.platform, code); result = "connected";
    }
  } catch (error) {
    result = error instanceof ApiError && error.code === "CHANNEL_ALREADY_CONNECTED" ? "already_connected" : error instanceof ApiError && error.code === "CHANNEL_REPLACEMENT_REQUIRED" ? "disconnect_first" : "tester_or_permission_required";
  }
  const response = NextResponse.redirect(`${base}/settings/account?meta=${result}`);
  response.cookies.set(META_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/api/v1/meta", maxAge: 0 });
  return response;
}
