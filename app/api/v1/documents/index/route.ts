import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse, ApiError } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { documentIndex } from "@/lib/server/document-index";
import { fuzzyDocumentScore } from "@/lib/knowledge-navigation";
import { resolveWikiLink } from "@/lib/knowledge-links";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") ?? "all";
    if (!["all", "mine_company", "mine", "canonical", "team", "review", "archived"].includes(scope) &&
      !(scope.startsWith("member:") && z.string().uuid().safeParse(scope.slice(7)).success)) {
      throw new ApiError(400, "INVALID_SCOPE", "문서 조회 범위를 확인해 주세요.");
    }
    const rows = await documentIndex(scope, actor.id);
    const target = url.searchParams.get("target");
    if (target) return NextResponse.json({ document: resolveWikiLink(target, rows, url.searchParams.get("folder") ?? "") ?? null });
    if (url.searchParams.get("folders") === "true") {
      const folders = new Map<string, number>();
      for (const row of rows) folders.set(row.folder || "분류 없음", (folders.get(row.folder || "분류 없음") ?? 0) + 1);
      return NextResponse.json({ folders: [...folders].map(([path, count]) => ({ path, count })), total: rows.length });
    }
    const q = (url.searchParams.get("q") ?? "").normalize("NFC").toLowerCase();
    return NextResponse.json({ documents: rows.map((row) => ({ row, score: Math.max(fuzzyDocumentScore(q, row.title), fuzzyDocumentScore(q, row.source_ref ?? "")) })).filter((item) => item.score >= 0).sort((a, b) => b.score - a.score || a.row.title.localeCompare(b.row.title, "ko")).slice(0, 30).map((item) => item.row) });
  } catch (error) { return apiErrorResponse(error); }
}
