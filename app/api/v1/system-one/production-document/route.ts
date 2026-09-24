import { NextResponse } from "next/server";
import { canUseSystemOneContentEvidence } from "@/lib/system-one-content-evidence-gate";
import { createSystemOneUserDocumentSource } from "@/lib/server/system-one-user-source";
import { readProductionDocument } from "@/lib/server/system-one-production-document";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "cache-control": "private, no-store", vary: "Authorization" };
const stopped = (code: string, status: number) => NextResponse.json({ status: "stopped", code }, { status, headers });
export async function GET(request: Request) {
  // This authenticated, summary-only read has no AI or external-provider call.
  // Keep DEV isolation while allowing it alongside the manual evidence cards.
  if (!canUseSystemOneContentEvidence(process.env)) return stopped("not_enabled", 404);
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token || token.startsWith("bos_pat_")) return stopped("authentication_failed", 401);
  const query = new URL(request.url).searchParams;
  if (request.url.length > 2000 || [...query.keys()].length !== 1 || !query.has("id")) return stopped("invalid_input", 400);
  try {
    const result = await readProductionDocument(query.get("id"), createSystemOneUserDocumentSource(request));
    if (result.status === "stopped") return stopped(result.code, result.code === "invalid_input" ? 400 : result.code === "authentication_failed" ? 401 : result.code === "unavailable" ? 404 : result.code === "read_failed" ? 503 : 409);
    return NextResponse.json({ status: "ready", document: result.document, policyStatus: "unverified", judgment: null, executionAllowed: false }, { headers });
  } catch { return stopped("read_failed", 503); }
}
