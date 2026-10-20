import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { pipelineArtifacts } from "@/lib/content-pipeline";
import { parseTimedTranscript } from "@/lib/content-input";
import type { ShortformLongformInput } from "@/lib/shortform-longform";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { RequestActor } from "./auth";
import { readYoutubeAutomationInput } from "./youtube-automation-input";

const finalSchema = z.object({
  video: z.string(), srt: z.string(), at: z.string().datetime(),
  durationSeconds: z.number().positive().max(14_400),
});

/** Resolve only the latest final made from the currently approved inputs, after checking the caller's source access. */
export async function readShortformLongform(actor: Pick<RequestActor,"supabase">, sourceId: string, expectedKey?: string,
  serviceFactory = createServiceSupabase): Promise<ShortformLongformInput> {
  const { state, plan } = await readYoutubeAutomationInput(actor.supabase, sourceId);
  const run = pipelineArtifacts(state.records).myin;
  if (!plan.inputKey || !run || run.status !== "done" || run.metadata.inputKey !== plan.inputKey)
    throw new ApiError(409, "SHORTFORM_LONGFORM_NOT_READY", "현재 승인된 원고로 만든 롱폼 완성본이 필요합니다. ③ 영상 제작을 먼저 확인해 주세요.");
  const parsed = finalSchema.safeParse(run.metadata.final);
  if (!parsed.success) throw new ApiError(409, "SHORTFORM_LONGFORM_INVALID", "롱폼 완성본의 영상·자막 정보를 읽지 못했습니다.");
  const final = parsed.data;
  // Metadata is untrusted: never sign or download a path outside this exact run, including traversal paths.
  const prefix = `${run.owner_id}/${sourceId}/${run.id}/`;
  if (!final.video.startsWith(prefix) || !/^final_myin-[a-f0-9]{8}\.mp4$/.test(final.video.slice(prefix.length))
    || !final.srt.startsWith(prefix) || !/^subs_youtube-[a-f0-9]{8}\.srt$/.test(final.srt.slice(prefix.length)))
    throw new ApiError(409, "SHORTFORM_LONGFORM_INVALID", "롱폼 완성본의 저장 경로를 확인해 주세요.");
  const key = createHash("sha256").update(JSON.stringify(["shortform-longform-v1", sourceId, run.id, plan.inputKey, final])).digest("hex");
  if (expectedKey && expectedKey !== key)
    throw new ApiError(409, "SHORTFORM_LONGFORM_CHANGED", "롱폼 완성본이 바뀌었습니다. OS 롱폼 완성본을 다시 불러와 구간을 확인해 주세요.");
  const service = serviceFactory();
  const { data: captions, error: captionError } = await service.storage.from("os-content-media").download(final.srt);
  if (captionError || !captions || captions.size > 2_000_000)
    throw new ApiError(409, "SHORTFORM_LONGFORM_CAPTIONS_MISSING", "롱폼 자막 파일을 읽지 못했습니다. 자막 파일과 보관 상태를 확인해 주세요.");
  const transcript = await captions.text();
  const cues = parseTimedTranscript(transcript);
  if (!cues.length || cues.some((cue) => cue.start < 0 || cue.end > final.durationSeconds + 1))
    throw new ApiError(409, "SHORTFORM_LONGFORM_CAPTIONS_INVALID", "롱폼 자막의 실제 시각을 확인해 주세요.");
  const { data, error } = await service.storage.from("os-youtube-video").createSignedUrl(final.video, 3_600);
  if (error || !data) throw new ApiError(404, "SHORTFORM_LONGFORM_VIDEO_MISSING", "롱폼 영상 파일을 읽지 못했습니다.");
  return { reference: { kind: "os_longform_v1", runId: run.id, key }, videoUrl: data.signedUrl, transcript,
    durationSeconds: final.durationSeconds, expiresIn: 3_600 };
}
