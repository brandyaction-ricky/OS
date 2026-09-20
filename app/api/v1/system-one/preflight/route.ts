import { NextResponse } from "next/server";
import { canUseSystemOnePreflight } from "@/lib/system-one-preflight-gate";
import { loadSystemOneDocumentBundle } from "@/lib/server/system-one-document-source";
import { createSystemOneUserDocumentSource } from "@/lib/server/system-one-user-source";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;
const maxBytes = 4_096;
const headers = { "cache-control": "private, no-store", vary: "Authorization" };
const stopped = (code: string, status: number) => NextResponse.json({ status: "stopped", code }, { status, headers });

async function boundedJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; large: boolean }> {
  const declaredSize = request.headers.get("content-length");
  if (declaredSize !== null && (!/^\d+$/.test(declaredSize) || !Number.isSafeInteger(Number(declaredSize)))) return { ok: false, large: false };
  if (declaredSize !== null && Number(declaredSize) > maxBytes) return { ok: false, large: true };
  if (!request.body) return { ok: false, large: false };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return { ok: false, large: true };
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { ok: false, large: false };
  } finally {
    reader.releaseLock();
  }
}

// No judgment, storage, external AI, mutation, or local-mock fallback.
export async function POST(request: Request) {
  if (!canUseSystemOnePreflight(process.env)) return stopped("not_enabled", 404);
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token || token.startsWith("bos_pat_")) return stopped("authentication_failed", 401);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return stopped("invalid_input", 415);
  try {
    const input = await boundedJson(request);
    if (!input.ok) return stopped(input.large ? "input_too_large" : "invalid_input", input.large ? 413 : 400);
    const result = await loadSystemOneDocumentBundle(input.value, createSystemOneUserDocumentSource(request));
    if (result.status === "stopped") {
      const status = { invalid_input: 400, authentication_failed: 401, unavailable: 404, invalid_metadata: 422, stale: 409, read_failed: 503 }[result.code];
      return stopped(result.code, status);
    }
    // Explicit projection: never send titles, bodies, profiles or fingerprints.
    return NextResponse.json({
      status: "ready", policyStatus: "unverified", judgment: null, executionAllowed: false,
      checkedAt: result.bundle.checkedAt,
      documents: [result.bundle.source, ...result.bundle.criteria].map((document, index) => ({
        role: index === 0 ? "source" : "criterion", id: document.id,
        version: document.current_version, state: "head_verified",
      })),
    }, { headers });
  } catch {
    return stopped("read_failed", 503);
  }
}
