import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { readPipeline } from "@/lib/server/content-pipeline";
import { createVoiceRun, parseVoiceRun, presentVoiceRun, voiceRunId, voiceSegmentPath, YOUTUBE_VOICE_BUCKET, YOUTUBE_VOICE_RUN_KIND } from "@/lib/server/youtube-voice-run";
import { createServiceSupabase } from "@/lib/supabase/server";
import { canUseYoutubeAutomationPilot } from "@/lib/youtube-automation-gate";
import type { OsRecord } from "@/lib/record-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const inputSchema = z.object({ sourceId: z.string().uuid(), inputKey: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const noStore = { "cache-control": "private, no-store", vary: "Authorization" };

function requirePilot() {
  if (!canUseYoutubeAutomationPilot(process.env)) throw new ApiError(404, "AUTOMATION_PILOT_DISABLED", "영상 자동화 파일럿이 아직 연결되지 않았습니다.");
}

export async function GET(request: Request) {
  try {
    requirePilot();
    const actor = await authenticateRequest(request, { allowAgent: false });
    const query = new URL(request.url).searchParams;
    const sourceId = z.string().uuid().parse(query.get("sourceId"));
    const state = await readPipeline(actor, sourceId);
    if (state.source.owner_id !== actor.id) throw new ApiError(403, "CONTENT_OWNER_REQUIRED", "이 콘텐츠의 소유자만 음성 제작 결과를 볼 수 있습니다.");
    const runId = query.get("runId");
    const segmentIndex = query.get("segmentIndex");
    if (runId !== null || segmentIndex !== null) {
      if (runId === null || segmentIndex === null) throw new ApiError(400, "INVALID_VOICE_RUN_INPUT", "음성 작업 번호와 단락 번호가 필요합니다.");
      const id = z.string().uuid().parse(runId);
      const index = z.coerce.number().int().min(0).max(79).parse(segmentIndex);
      const { data, error } = await actor.supabase.from("os_records").select("*").eq("id", id).eq("parent_id", sourceId)
        .eq("record_type", "ai_job").eq("owner_id", actor.id).eq("metadata->>kind", YOUTUBE_VOICE_RUN_KIND).is("archived_at", null).maybeSingle();
      if (error || !data) throw new ApiError(404, "VOICE_RUN_NOT_FOUND", "음성 제작 작업을 찾지 못했습니다.");
      const record = data as OsRecord;
      const metadata = parseVoiceRun(record);
      if (record.created_by !== actor.id || metadata.sourceId !== sourceId || record.id !== voiceRunId(metadata.runKey))
        throw new ApiError(409, "VOICE_RUN_INVALID", "음성 제작 작업의 소유권을 확인할 수 없습니다.");
      const segment = metadata.segments[index];
      const expectedPath = voiceSegmentPath(actor.id, sourceId, id, index);
      if (!segment || segment.index !== index || segment.status !== "ready" || segment.path !== expectedPath)
        throw new ApiError(409, "VOICE_SEGMENT_NOT_READY", "이 단락의 음성 파일이 아직 준비되지 않았습니다.");
      const { data: signed, error: signError } = await createServiceSupabase().storage.from(YOUTUBE_VOICE_BUCKET).createSignedUrl(expectedPath, 60);
      if (signError || !signed?.signedUrl) throw new ApiError(503, "VOICE_AUDIO_UNAVAILABLE", "음성 파일을 열 수 없습니다.");
      return NextResponse.json({ url: signed.signedUrl, expiresInSeconds: 60 }, { headers: noStore });
    }
    const { data, error } = await actor.supabase.from("os_records").select("*").eq("parent_id", sourceId)
      .eq("record_type", "ai_job").eq("owner_id", actor.id).eq("metadata->>kind", YOUTUBE_VOICE_RUN_KIND)
      .is("archived_at", null).order("created_at", { ascending: false }).limit(10);
    if (error) throw new ApiError(500, "VOICE_RUN_READ_FAILED", "음성 제작 이력을 읽지 못했습니다.");
    return NextResponse.json({ runs: (data ?? []).map((record) => presentVoiceRun(record as OsRecord)) }, { headers: noStore });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_VOICE_RUN_INPUT", "콘텐츠와 음성 작업 번호를 확인해 주세요."));
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requirePilot();
    const actor = await authenticateRequest(request, { allowAgent: false });
    const input = inputSchema.parse(await parseJson(request, 1_000));
    return NextResponse.json(await createVoiceRun(actor, input.sourceId, input.inputKey), { status: 202, headers: noStore });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_VOICE_RUN_INPUT", "콘텐츠와 원고 버전을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
