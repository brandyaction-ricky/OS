import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/lib/http";
import { readPlanningHandoff } from "@/lib/content-planning-handoff";
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
const candidateSchema = z.object({ title: z.string().trim().max(300).optional(), thumbnailCopy: z.string().trim().max(500).optional() }).passthrough();
const stopped = (code: string, status: number) => NextResponse.json({ status: "stopped", code }, { status, headers });
const asText = (value: unknown, limit: number) => typeof value === "string" && value.trim().length <= limit ? value.trim() : "";

export async function POST(request: Request) {
  if (!canUseSystemOneJevShadow(process.env)) return stopped("not_enabled", 404);
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
    const candidate = candidateSchema.safeParse(source.metadata.pickedCandidate);
    if (!handoff) return stopped("material_incomplete", 409);
    const title = candidate.success ? candidate.data.title || source.title : source.title;
    const thumbnailCopy = handoff.thumbnailCopy || (candidate.success ? candidate.data.thumbnailCopy ?? "" : "");
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

    return NextResponse.json({ status: "ready", source: { id: source.id, version: source.version },
      shadowEvaluation }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const name = error instanceof Error ? error.name : "";
    if (message === "JEV_PROVIDER_FAILED" || message === "JEV_INVALID_RESPONSE" || message === "JEV_RESPONSE_TOO_LARGE" ||
      name === "TimeoutError" || name === "AbortError") {
      return stopped("provider_unavailable", 503);
    }
    return stopped("read_failed", 503);
  }
}
