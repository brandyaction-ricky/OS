import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/lib/http";
import { packagingEvidence } from "@/lib/content-packaging-evidence";
import { readPlanningHandoff } from "@/lib/content-planning-handoff";
import type { OsRecord } from "@/lib/record-types";
import { authenticateRequest } from "@/lib/server/auth";
import { evaluateJevPackagingShadow } from "@/lib/server/system-one-jev-shadow";
import { canUseSystemOneJevShadow } from "@/lib/system-one-jev-shadow-gate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;
const headers = { "cache-control": "private, no-store", vary: "Authorization" };
const inputSchema = z.object({ id: z.string().uuid(), expectedVersion: z.number().int().positive().max(2_147_483_647) }).strict();
const rowSchema = z.object({
  id: z.string().uuid(), record_type: z.literal("content_topic"), title: z.string().trim().min(1).max(300),
  description: z.string().trim().min(1).max(120_000), brand: z.literal("브랜디액션"), owner_id: z.string().uuid(),
  metadata: z.record(z.unknown()), version: z.number().int().positive(), archived_at: z.null(),
}).strict();
const stopped = (code: string, status: number) => NextResponse.json({ status: "stopped", code }, { status, headers });
const asText = (value: unknown, limit: number) => typeof value === "string" && value.trim().length <= limit ? value.trim() : "";

export async function POST(request: Request) {
  if (!canUseSystemOneJevShadow(process.env)) return stopped("not_enabled", 404);
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token || token.startsWith("bos_pat_")) return stopped("authentication_failed", 401);
  let input: z.infer<typeof inputSchema>;
  try {
    const parsed = inputSchema.safeParse(await parseJson(request, 1_000));
    if (!parsed.success) return stopped("invalid_input", 400);
    input = parsed.data;
  } catch { return stopped("invalid_input", 400); }

  try {
    const actor = await authenticateRequest(request, { allowAgent: false, allowPasswordChangeRequired: false });
    if (actor.type !== "user" || actor.user?.id !== actor.id || actor.mustChangePassword) return stopped("authentication_failed", 401);
    const { data, error } = await actor.supabase.from("os_records")
      .select("id,record_type,title,description,brand,owner_id,metadata,version,archived_at")
      .eq("id", input.id).eq("record_type", "content_topic").eq("owner_id", actor.id).is("archived_at", null)
      .abortSignal(AbortSignal.timeout(10_000)).maybeSingle();
    if (error) return stopped("read_failed", 503);
    const parsed = rowSchema.safeParse(data);
    if (!parsed.success) return stopped("unavailable", 404);
    const source = parsed.data;
    if (source.version !== input.expectedVersion) return stopped("stale", 409);

    const handoff = readPlanningHandoff(source.metadata.planningHandoff);
    if (!handoff) return stopped("material_incomplete", 409);
    const { data: packageRows, error: packageError } = await actor.supabase.from("os_records")
      .select("*").eq("parent_id", source.id).eq("record_type", "content_package")
      .eq("owner_id", actor.id).eq("metadata->>packageKind", "title_package").is("archived_at", null)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(200)
      .abortSignal(AbortSignal.timeout(10_000));
    if (packageError) return stopped("read_failed", 503);
    const selected = packagingEvidence(source.id, (packageRows ?? []) as OsRecord[], handoff.thumbnailCopy);
    if (selected.status !== "loaded" || selected.titles.state !== "single" || selected.copies.state !== "single" || !selected.package || selected.copyDiffers)
      return stopped("packaging_selection_required", 409);
    const title = selected.titles.texts[0];
    const thumbnailCopy = selected.copies.texts[0];
    const audience = asText(source.metadata.audience, 1_000) || asText(source.metadata.targetAudience, 1_000) || "브랜디액션 유튜브 시청자";
    if (!title || !thumbnailCopy || !handoff.evidenceNotes || !handoff.titlePromise) return stopped("material_incomplete", 409);

    const timeout = AbortSignal.timeout(12_000);
    const shadowEvaluation = await evaluateJevPackagingShadow({
      title, thumbnailCopy, audience, coreContent: source.description.slice(0, 4_000),
      evidenceNotes: handoff.evidenceNotes, viewerPromise: handoff.titlePromise,
    }, { apiKey: process.env.TYPESAFE_API_KEY ?? "", model: process.env.TYPESAFE_JEV_MODEL, signal: timeout });

    // The result is observation only, but avoid displaying a result for input
    // that changed while the external call was in flight.
    const { data: latest, error: latestError } = await actor.supabase.from("os_records")
      .select("id,owner_id,version,archived_at").eq("id", source.id).eq("owner_id", actor.id).is("archived_at", null)
      .abortSignal(AbortSignal.timeout(10_000)).maybeSingle();
    if (latestError) return stopped("read_failed", 503);
    if (!latest || latest.id !== source.id || latest.owner_id !== actor.id || latest.archived_at !== null || latest.version !== source.version) return stopped("stale", 409);
    const { data: latestPackage, error: latestPackageError } = await actor.supabase.from("os_records")
      .select("id,owner_id,version,archived_at").eq("id", selected.package.id).eq("owner_id", actor.id).is("archived_at", null)
      .abortSignal(AbortSignal.timeout(10_000)).maybeSingle();
    if (latestPackageError) return stopped("read_failed", 503);
    if (!latestPackage || latestPackage.id !== selected.package.id || latestPackage.owner_id !== actor.id || latestPackage.archived_at !== null || latestPackage.version !== selected.package.version)
      return stopped("stale", 409);

    return NextResponse.json({ status: "ready", source: { id: source.id, version: source.version },
      evaluationProtocolVersion: "jev-packaging-review-v3",
      inputChecks: { selectedPackage: true, planningHandoff: true, evidenceNotes: true, factualVerification: false },
      shadowEvaluation }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const name = error instanceof Error ? error.name : "";
    if (message === "JEV_NOT_CONFIGURED") return stopped("provider_not_configured", 503);
    if (message === "JEV_INVALID_RESPONSE") return stopped("provider_response_invalid", 503);
    if (message === "JEV_RESPONSE_TOO_LARGE") return stopped("provider_response_too_large", 503);
    if (message === "JEV_PROVIDER_HTTP_401" || message === "JEV_PROVIDER_HTTP_403") return stopped("provider_auth_failed", 503);
    if (message === "JEV_PROVIDER_HTTP_429") return stopped("provider_rate_limited", 503);
    if (/^JEV_PROVIDER_HTTP_4\d\d$/.test(message)) return stopped("provider_request_rejected", 503);
    if (/^JEV_PROVIDER_HTTP_5\d\d$/.test(message)) return stopped("provider_unavailable", 503);
    if (name === "TimeoutError" || name === "AbortError") return stopped("provider_timeout", 503);
    return stopped("read_failed", 503);
  }
}
