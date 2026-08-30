import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { exchangeYoutubeCode, saveYoutubeConnection, verifyYoutubeOAuthState, YOUTUBE_OAUTH_COOKIE } from "@/lib/server/youtube-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resultUrl(result: string) {
  const base = (process.env.OS_PUBLIC_URL || "https://brandyaction-os.vercel.app").replace(/\/$/, "");
  return `${base}/content/youtube?youtube=${encodeURIComponent(result)}`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cookieStore = await cookies();
  const oauthCookie = cookieStore.get(YOUTUBE_OAUTH_COOKIE)?.value;
  const clear = (response: NextResponse) => { response.cookies.set(YOUTUBE_OAUTH_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/api/v1/youtube/oauth", maxAge: 0 }); return response; };
  if (url.searchParams.get("error")) return clear(NextResponse.redirect(resultUrl("denied")));
  try {
    const ownerId = verifyYoutubeOAuthState(oauthCookie, url.searchParams.get("state"));
    const code = url.searchParams.get("code");
    if (!code) return clear(NextResponse.redirect(resultUrl("missing_code")));
    const tokens = await exchangeYoutubeCode(code);
    await saveYoutubeConnection(ownerId, tokens);
    return clear(NextResponse.redirect(resultUrl("connected")));
  } catch (error) {
    console.error("YouTube OAuth callback failed", error instanceof Error ? error.message : "unknown error");
    return clear(NextResponse.redirect(resultUrl("failed")));
  }
}
