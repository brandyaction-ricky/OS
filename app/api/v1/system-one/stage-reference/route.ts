import { NextResponse } from "next/server";
import { canUseSystemOnePreflight } from "@/lib/system-one-preflight-gate";
import { planningRegistryConfig } from "@/lib/server/system-one-planning";
import { readStageReferences } from "@/lib/server/system-one-stage-references";
import { createSystemOneUserContentSource } from "@/lib/server/system-one-user-content-source";
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
  if (request.url.length > 2_000 || [...query.keys()].length !== 3 || !query.has("id") || !query.has("version") ||
    !query.has("stage") || !/^[1-9]\d{0,9}$/.test(query.get("version") ?? "") ||
    !["packaging", "writing"].includes(query.get("stage") ?? "")) return stopped("invalid_input", 400);
  try {
    const result = await readStageReferences({ id: query.get("id"), expectedVersion: Number(query.get("version")), stage: query.get("stage") },
      registry, { content: createSystemOneUserContentSource(request), documents: createSystemOneUserDocumentSource(request) });
    if (result.status === "stopped") return stopped(result.code, result.code === "authentication_failed" ? 401 :
      result.code === "invalid_input" ? 400 : result.code === "unavailable" ? 404 : result.code === "read_failed" ? 503 : 409);
    return NextResponse.json({ status: "ready", stage: result.stage, source: result.source,
      registryVersion: result.registryVersion, entryDocument: result.entryDocument,
      dependenciesStatus: "unresolved", approvalStatus: "unverified", policyStatus: "unverified", judgment: null, executionAllowed: false }, { headers });
  } catch { return stopped("read_failed", 503); }
}
