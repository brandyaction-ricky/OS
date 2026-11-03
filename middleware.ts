import { NextResponse, type NextRequest } from "next/server";

// Old 회사 문서 addresses (/knowledge?…) get a 308 before any page renders. Redirecting from the page instead happens inside
// the streamed (os) layout, so the browser receives the page, then a refresh tag, and loads twice (~0.3 s more on 11-03).
// Same targets as app/(os)/knowledge/page.tsx (kept as the fallback). In-app moves get the same 308 and the router follows it.
export function middleware(request: NextRequest) {
  const query = request.nextUrl.searchParams, url = request.nextUrl.clone();
  const document = query.get("document");
  url.search = "";
  if (document) url.pathname = `/knowledge/doc/${encodeURIComponent(document)}`;
  else if (query.get("tab") === "canon") url.pathname = "/knowledge/canon";
  else if (query.get("new") === "1") { url.pathname = "/knowledge/notes"; url.search = "?new=1&tab=all"; }
  else url.pathname = "/knowledge/vault";
  return NextResponse.redirect(url, 308);
}

export const config = { matcher: "/knowledge" };
