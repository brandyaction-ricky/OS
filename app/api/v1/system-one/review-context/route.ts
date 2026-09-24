import { NextResponse } from "next/server";
import { canUseSystemOnePreflight } from "@/lib/system-one-preflight-gate";
import { planningRegistryConfig } from "@/lib/server/system-one-planning";
import { readReviewContext } from "@/lib/server/system-one-review-context";
import { createSystemOneUserContentSource, createSystemOneUserPackagingSource } from "@/lib/server/system-one-user-content-source";
import { createSystemOneUserDocumentSource } from "@/lib/server/system-one-user-source";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "cache-control": "private, no-store", vary: "Authorization" };
const stopped = (code: string, status: number) => NextResponse.json({ status: "stopped", code }, { status, headers });
export async function GET(request: Request) {
  if (!canUseSystemOnePreflight(process.env)) return stopped("not_enabled", 404);
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token || token.startsWith("bos_pat_")) return stopped("authentication_failed", 401);
  const registry = planningRegistryConfig(process.env);
  if (!registry) return stopped("setup_required", 503);
  const query = new URL(request.url).searchParams;
  if (request.url.length > 2_000 || [...query.keys()].length !== 2 || !query.has("id") || !query.has("version") ||
    !/^[1-9]\d{0,9}$/.test(query.get("version") ?? "")) return stopped("invalid_input", 400);
  try {
    const result = await readReviewContext({ id: query.get("id"), expectedVersion: Number(query.get("version")) }, registry,
      { content: createSystemOneUserContentSource(request), packaging: createSystemOneUserPackagingSource(request),
        documents: createSystemOneUserDocumentSource(request) }, token);
    if (result.status === "stopped") return stopped(result.code, result.code === "authentication_failed" ? 401 :
      result.code === "invalid_input" ? 400 : result.code === "unavailable" ? 404 : result.code === "read_failed" ? 503 : 409);
    return NextResponse.json({ status: "ready", policyStatus: "unverified", judgment: null, executionAllowed: false,
      source: result.source, registryVersion: result.registryVersion, referenceCount: result.referenceCount,
      packageCount: result.packageCount, markers: result.markers, linkedDocuments: result.linkedDocuments }, { headers });
  } catch { return stopped("read_failed", 503); }
}
