import { NextResponse, type NextRequest } from "next/server";
import { retiredRoute } from "@/lib/final-routes";
import { youtubeV1Mode } from "@/lib/youtube-process/gate";

// Old addresses are answered with a redirect before any page renders. Redirecting from the page happens inside the
// streamed (os) layout, so the browser first loads the whole app and only then moves (the old 회사 문서 forms even loaded
// it twice): 0.1-0.5 s more on 11-03. Each target is the one the page itself ends on; the pages keep their redirects as
// the fallback. Redirects that read the database (the old team menus) stay with their page.
const FIXED: Record<string, string> = {
  "/content": "/content/topics",
  "/contents": "/content/topics",
  "/finance": "/finance/overview",
  "/settings": "/settings/connections",
  "/content/automation": "/automation/topics",
  "/content/review": "/automation/review",
  "/content/comments": "/automation/performance?tab=comments",
  "/automation/library": "/automation/dashboard?moved=library",
  "/automation/templates": "/automation/settings?tab=templates",
  "/organization/projects": "/organization/meetings",
  "/performance/connections": "/settings/connections",
};
// With 유튜브 공정 v1 on for everyone the old step screens open the v1 screen (app/(os)/content/[page]/page.tsx).
const V1_REPLACED: Record<string, string> = { "/content/topics": "/content/projects?view=discover", "/content/scripts": "/content/projects", "/content/video": "/content/projects", "/content/packages": "/content/projects" };

export function redirectTarget(path: string, query: URLSearchParams) {
  if (path === "/knowledge") {
    const document = query.get("document");
    if (document) return `/knowledge/doc/${encodeURIComponent(document)}`;
    return query.get("tab") === "canon" ? "/knowledge/canon" : query.get("new") === "1" ? "/knowledge/notes?new=1&tab=all" : "/knowledge/vault";
  }
  const step = FIXED[path] ?? path;
  if (V1_REPLACED[step] && youtubeV1Mode() === "all") return V1_REPLACED[step];
  if (FIXED[path]) return FIXED[path];
  // Every 성과 page is retired; the ones without a notice of their own pass through /performance/overview first.
  if (path === "/performance" || path.startsWith("/performance/")) return retiredRoute(path) ?? retiredRoute("/performance/overview");
  const retired = retiredRoute(path);
  if (retired) return retired;
  const detail = /^\/automation\/([^/]+)\/([^/]+)$/.exec(path);
  if (detail) return ["cardnews", "shorts", "threads"].includes(detail[1]) && /^[0-9a-f-]{36}$/i.test(detail[2]) ? `/automation/${detail[1]}?sel=${encodeURIComponent(detail[2])}` : "/automation/dashboard?missing=1";
  return null;
}

export function middleware(request: NextRequest) {
  const target = redirectTarget(request.nextUrl.pathname, request.nextUrl.searchParams);
  if (!target) return NextResponse.next();
  const url = request.nextUrl.clone(), [pathname, search] = target.split("?");
  url.pathname = pathname;
  url.search = search ? `?${search}` : "";
  // The pages use permanentRedirect only for the old 회사 문서 forms; everything else was a temporary redirect.
  return NextResponse.redirect(url, request.nextUrl.pathname === "/knowledge" ? 308 : 307);
}

// Only these exact old addresses run the middleware, so ordinary pages and their in-app reads never pass through it.
export const config = {
  matcher: [
    "/knowledge", "/content", "/contents", "/finance", "/settings", "/performance", "/performance/:path*",
    "/content/topics", "/content/scripts", "/content/video", "/content/packages", "/content/automation", "/content/review", "/content/comments",
    "/automation/library", "/automation/templates", "/automation/:page/:id",
    "/organization/projects", "/organization/finance", "/home/goals", "/home/reports", "/knowledge/skills",
  ],
};
