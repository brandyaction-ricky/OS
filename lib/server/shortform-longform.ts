import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { pipelineArtifacts } from "@/lib/content-pipeline";
import { parseTimedTranscript } from "@/lib/content-input";
import type { OsRecord } from "@/lib/record-types";
import type { ShortformLongformInput } from "@/lib/shortform-longform";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { RequestActor } from "./auth";
import { readYoutubeAutomationInput } from "./youtube-automation-input";
import { isYoutubeV1, v1Stages } from "./youtube-process-ai";

const finalSchema = z.object({
  video: z.string(), srt: z.string(), at: z.string().datetime(),
  durationSeconds: z.number().positive().max(14_400),
});

type Final = { ref: string; bucket: string; video: string; srt: string; at: string; durationSeconds: number | null; inputKey: string };
/** The old pipeline: only the latest final made from the currently approved inputs. */
function pipelineFinal(state: Awaited<ReturnType<typeof readYoutubeAutomationInput>>["state"], inputKey: string | null, sourceId: string): Final {
  const run = pipelineArtifacts(state.records).myin;
  if (!inputKey || !run || run.status !== "done" || run.metadata.inputKey !== inputKey)
    throw new ApiError(409, "SHORTFORM_LONGFORM_NOT_READY", "현재 승인된 원고로 만든 롱폼 완성본이 필요합니다. ③ 영상 제작을 먼저 확인해 주세요.");
  return { ...myinFinal(run, sourceId), inputKey };
}
function myinFinal(run: OsRecord, sourceId: string) {
  const parsed = finalSchema.safeParse(run.metadata.final);
  if (!parsed.success) throw new ApiError(409, "SHORTFORM_LONGFORM_INVALID", "롱폼 완성본의 영상·자막 정보를 읽지 못했습니다.");
  const final = parsed.data;
  // Metadata is untrusted: never sign or download a path outside this exact run, including traversal paths.
  const prefix = `${run.owner_id}/${sourceId}/${run.id}/`;
  // Completed v13 runs before immutable lease suffixes used these exact unsuffixed basenames.
  if (!final.video.startsWith(prefix) || !/^final_myin(?:-[a-f0-9]{8})?\.mp4$/.test(final.video.slice(prefix.length))
    || !final.srt.startsWith(prefix) || !/^subs_youtube(?:-[a-f0-9]{8})?\.srt$/.test(final.srt.slice(prefix.length)))
    throw new ApiError(409, "SHORTFORM_LONGFORM_INVALID", "롱폼 완성본의 저장 경로를 확인해 주세요.");
  return { ref: run.id, bucket: "os-youtube-video", video: final.video, srt: final.srt, at: final.at, durationSeconds: final.durationSeconds };
}
/** 유튜브 공정 v1: the project's latest final, OS-made or uploaded by hand (with the SRT from 업로드), whatever step the project is on. */
function v1Final(state: Awaited<ReturnType<typeof readYoutubeAutomationInput>>["state"], sourceId: string): Final {
  const stages = v1Stages(state);
  const made = state.records.filter(row => !row.archived_at && row.record_type === "ai_job" && row.metadata.kind === "youtube_myin_v13" && row.stage === "final_ready" && row.status === "done")
    .map(run => myinFinal(run, sourceId));
  const id = stages.project.id;
  const srt = stages.upload.data.srt?.path ?? "";
  const uploads = stages.make.data.finals.map(item => ({ ref: `upload-v${item.v}`, bucket: "os-content-media", video: item.path, srt, at: item.at, durationSeconds: null }));
  const latest = [...made, ...uploads].sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  if (!latest) throw new ApiError(409, "SHORTFORM_LONGFORM_NOT_READY", "롱폼 최종본이 있어야 숏폼을 만들 수 있어요.");
  if (latest.bucket === "os-content-media" && (!new RegExp(`^youtube/${id}/final/[0-9a-f-]{36}\\.(mp4|mov|m4v|webm)$`).test(latest.video) || !new RegExp(`^youtube/${id}/srt/[0-9a-f-]{36}\\.srt$`).test(latest.srt)))
    throw new ApiError(409, "SHORTFORM_LONGFORM_CAPTIONS_MISSING", "직접 올린 최종본은 업로드 단계에서 SRT 자막을 올려야 숏폼으로 만들 수 있어요.");
  return { ...latest, inputKey: "yp-v1" };
}

/** Resolve the longform a shortform is cut from, after checking the caller's source access. */
export async function readShortformLongform(actor: Pick<RequestActor,"supabase">, sourceId: string, expectedKey?: string,
  serviceFactory = createServiceSupabase): Promise<ShortformLongformInput> {
  const { state, plan } = await readYoutubeAutomationInput(actor.supabase, sourceId);
  const { inputKey, bucket, ref, ...final } = isYoutubeV1(state.source) ? v1Final(state, sourceId) : pipelineFinal(state, plan.inputKey, sourceId);
  const key = createHash("sha256").update(JSON.stringify(["shortform-longform-v1", sourceId, ref, inputKey,
    bucket === "os-youtube-video" ? final : { ...final, bucket }])).digest("hex");
  if (expectedKey && expectedKey !== key)
    throw new ApiError(409, "SHORTFORM_LONGFORM_CHANGED", "롱폼 완성본이 바뀌었습니다. OS 롱폼 완성본을 다시 불러와 구간을 확인해 주세요.");
  const service = serviceFactory();
  const { data: captions, error: captionError } = await service.storage.from("os-content-media").download(final.srt);
  if (captionError || !captions || captions.size > 2_000_000)
    throw new ApiError(409, "SHORTFORM_LONGFORM_CAPTIONS_MISSING", "롱폼 자막 파일을 읽지 못했습니다. 자막 파일과 보관 상태를 확인해 주세요.");
  const transcript = await captions.text();
  const cues = parseTimedTranscript(transcript);
  if (!cues.length || cues.some((cue) => cue.start < 0 || final.durationSeconds !== null && cue.end > final.durationSeconds + 1))
    throw new ApiError(409, "SHORTFORM_LONGFORM_CAPTIONS_INVALID", "롱폼 자막의 실제 시각을 확인해 주세요.");
  const { data, error } = await service.storage.from(bucket).createSignedUrl(final.video, 3_600);
  if (error || !data) throw new ApiError(404, "SHORTFORM_LONGFORM_VIDEO_MISSING", "롱폼 영상 파일을 읽지 못했습니다.");
  // ponytail: a final uploaded by hand has no measured length; the last subtitle + 30s bounds the clip here and the render PC
  // probes the real file and stops a clip past its end. Record the length at upload if this bound gets in the way.
  return { reference: { kind: "os_longform_v1", runId: ref, key }, videoUrl: data.signedUrl, transcript,
    durationSeconds: final.durationSeconds ?? Math.min(14_400, Math.max(...cues.map((cue) => cue.end)) + 30), expiresIn: 3_600 };
}
