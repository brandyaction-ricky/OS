import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import type { YoutubeScenePlan } from "./youtube-scenes";
import { YOUTUBE_VISUAL_TEMPLATE_VERSION } from "@/lib/youtube-visual-template";

const normalizedSpeech = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]/gu, "");
const seconds = z.number().finite().nonnegative().max(14_400);
const timedWordSchema = z.object({
  text: z.string().trim().min(1).max(200),
  startSeconds: seconds,
  endSeconds: seconds,
}).strict();
const timedSegmentSchema = z.object({
  segmentIndex: z.number().int().nonnegative().max(79),
  offsetSeconds: seconds,
  durationSeconds: seconds.positive(),
  words: z.array(timedWordSchema).min(1).max(3_000),
}).strict();

/** Provider-neutral, verified word times from the final rendered voice files. */
export const youtubeTimedTranscriptSchema = z.object({
  audioSha256: z.string().regex(/^[a-f0-9]{64}$/),
  audioDurationSeconds: seconds.positive(),
  segments: z.array(timedSegmentSchema).min(1).max(80),
}).strict();
export type YoutubeTimedTranscript = z.infer<typeof youtubeTimedTranscriptSchema>;

const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const fishTimingArtifactSchema = z.object({
  version: z.literal("fish-stream-timing-v1"),
  textHash: z.string().regex(/^[a-f0-9]{64}$/),
  audioSha256: z.string().regex(/^[a-f0-9]{64}$/),
  durationSeconds: seconds.positive(),
  words: z.array(z.object({ text: z.string().min(1), startSeconds: seconds, endSeconds: seconds }).strict()).min(1).max(3_000),
}).strict();

/** Verify stored Fish segment artifacts against their actual MP3 bytes and the assembled final audio. */
export function createYoutubeTimedTranscriptFromFish(input: {
  scriptSegments: string[];
  finalAudio: Buffer;
  finalDurationSeconds: number;
  segments: { audio: Buffer; timing: unknown; offsetSeconds: number; measuredDurationSeconds: number }[];
}): YoutubeTimedTranscript {
  if (!input.finalAudio.length || !Number.isFinite(input.finalDurationSeconds) || input.finalDurationSeconds <= 0 ||
    input.segments.length !== input.scriptSegments.length || !input.segments.length)
    throw new ApiError(409, "YOUTUBE_AUDIO_ASSEMBLY_INVALID", "최종 음성과 단락 구성을 확인할 수 없습니다.");
  const segments: YoutubeTimedTranscript["segments"] = [];
  let priorEnd = 0;
  for (const [index, artifact] of input.segments.entries()) {
    const timing = fishTimingArtifactSchema.safeParse(artifact.timing);
    if (!timing.success || !artifact.audio.length || timing.data.audioSha256 !== hash(artifact.audio) ||
      timing.data.textHash !== hash(JSON.stringify(input.scriptSegments[index])))
      throw new ApiError(409, "YOUTUBE_AUDIO_CHANGED", "음성 단락과 단어 시간표가 일치하지 않습니다.");
    if (!Number.isFinite(artifact.offsetSeconds) || !Number.isFinite(artifact.measuredDurationSeconds) ||
      artifact.offsetSeconds < priorEnd - 0.02 || artifact.measuredDurationSeconds <= 0 ||
      Math.abs(artifact.measuredDurationSeconds - timing.data.durationSeconds) > 0.25 ||
      artifact.offsetSeconds + artifact.measuredDurationSeconds > input.finalDurationSeconds + 0.05)
      throw new ApiError(409, "YOUTUBE_AUDIO_ASSEMBLY_INVALID", "조립된 음성의 단락 시작점과 길이가 맞지 않습니다.");
    priorEnd = artifact.offsetSeconds + artifact.measuredDurationSeconds;
    segments.push({
      segmentIndex: index, offsetSeconds: artifact.offsetSeconds,
      durationSeconds: artifact.measuredDurationSeconds, words: timing.data.words,
    });
  }
  return youtubeTimedTranscriptSchema.parse({
    audioSha256: hash(input.finalAudio), audioDurationSeconds: input.finalDurationSeconds, segments,
  });
}

export type YoutubeTimedVisualBeat = {
  segmentIndex: number;
  beatIndex: number;
  spokenAnchor: string;
  visualAction: YoutubeScenePlan["scenes"][number]["visualBeats"][number]["visualAction"];
  composition: YoutubeScenePlan["scenes"][number]["visualBeats"][number]["composition"];
  graphicSpec: string;
  displayText: string;
  visualStartSeconds: number;
  typographyStartSeconds: number | null;
  endSeconds: number;
};

export type YoutubeRenderTimeline = {
  templateVersion: typeof YOUTUBE_VISUAL_TEMPLATE_VERSION;
  audioSha256: string;
  audioDurationSeconds: number;
  beats: YoutubeTimedVisualBeat[];
};

/**
 * Convert speech anchors into exact video positions without asking Sol to guess
 * seconds. The caller must supply verified word times for the final audio.
 */
export function alignYoutubeVisualBeats(
  plan: YoutubeScenePlan,
  scriptSegments: string[],
  transcriptInput: unknown,
  expectedAudioSha256: string,
): YoutubeRenderTimeline {
  const parsed = youtubeTimedTranscriptSchema.safeParse(transcriptInput);
  if (!parsed.success) throw new ApiError(409, "YOUTUBE_WORD_TIMES_INVALID", "최종 음성의 단어 시간표를 읽을 수 없습니다.");
  const transcript = parsed.data;
  if (!/^[a-f0-9]{64}$/.test(expectedAudioSha256) || transcript.audioSha256 !== expectedAudioSha256)
    throw new ApiError(409, "YOUTUBE_AUDIO_CHANGED", "단어 시간표와 최종 음성 파일의 버전이 다릅니다.");
  if (plan.scenes.length !== scriptSegments.length || transcript.segments.length !== scriptSegments.length)
    throw new ApiError(409, "YOUTUBE_TIMELINE_SEGMENTS_MISMATCH", "원고·화면·음성 단락 수가 다릅니다.");

  const beats: YoutubeTimedVisualBeat[] = [];
  let priorSegmentEnd = 0;
  for (let segmentIndex = 0; segmentIndex < scriptSegments.length; segmentIndex++) {
    const scene = plan.scenes[segmentIndex];
    const segment = transcript.segments[segmentIndex];
    if (scene.segmentIndex !== segmentIndex || segment.segmentIndex !== segmentIndex ||
      segment.offsetSeconds < priorSegmentEnd - 0.02 ||
      segment.offsetSeconds + segment.durationSeconds > transcript.audioDurationSeconds + 0.05)
      throw new ApiError(409, "YOUTUBE_TIMELINE_SEGMENTS_MISMATCH", "음성 단락의 순서 또는 길이를 확인해 주세요.");
    priorSegmentEnd = segment.offsetSeconds + segment.durationSeconds;

    let previousWordEnd = 0;
    const textParts: string[] = [];
    const characterWordIndexes: number[] = [];
    for (const [wordIndex, word] of segment.words.entries()) {
      if (word.endSeconds <= word.startSeconds || word.startSeconds < previousWordEnd - 0.02 ||
        word.endSeconds > segment.durationSeconds + 0.05)
        throw new ApiError(409, "YOUTUBE_WORD_TIMES_INVALID", "음성 단어의 시간 순서가 맞지 않습니다.");
      previousWordEnd = word.endSeconds;
      const normalized = normalizedSpeech(word.text);
      if (!normalized) continue;
      textParts.push(normalized);
      for (let i = 0; i < normalized.length; i++) characterWordIndexes.push(wordIndex);
    }
    const spokenText = textParts.join("");
    const sourceText = normalizedSpeech(scriptSegments[segmentIndex]);
    if (!sourceText || spokenText !== sourceText)
      throw new ApiError(409, "YOUTUBE_TRANSCRIPT_MISMATCH", "음성 전사와 승인된 원고가 일치하지 않습니다. 검증된 단어 시간표가 필요합니다.");

    const starts: number[] = [];
    let searchFrom = 0;
    for (const beat of scene.visualBeats) {
      const anchor = normalizedSpeech(beat.spokenAnchor);
      const characterIndex = anchor ? sourceText.indexOf(anchor, searchFrom) : -1;
      if (characterIndex < 0)
        throw new ApiError(409, "YOUTUBE_ANCHOR_MISMATCH", "화면 비트의 멘트를 승인된 원고 순서에서 찾지 못했습니다.");
      const wordIndex = characterWordIndexes[characterIndex];
      const start = segment.offsetSeconds + segment.words[wordIndex].startSeconds;
      if (starts.length && start <= starts[starts.length - 1] + 0.04)
        throw new ApiError(409, "YOUTUBE_ANCHOR_MISMATCH", "화면 비트의 발화 시점을 서로 구분할 수 없습니다.");
      starts.push(start);
      searchFrom = characterIndex + anchor.length;
    }

    const segmentEnd = segment.offsetSeconds + segment.durationSeconds;
    for (const [beatIndex, beat] of scene.visualBeats.entries()) {
      const start = starts[beatIndex];
      const end = starts[beatIndex + 1] ?? segmentEnd;
      const span = end - start;
      if (span < 0.45 || (beat.visualAction === "draw_character" && span < 1.25))
        throw new ApiError(409, "YOUTUBE_BEAT_TOO_SHORT", "일부 멘트의 화면 시간이 너무 짧습니다. 화면 비트를 다시 설계해 주세요.");
      const typographyDelay = Math.min(0.32, Math.max(0.18, span * 0.2));
      beats.push({
        segmentIndex, beatIndex, spokenAnchor: beat.spokenAnchor,
        visualAction: beat.visualAction, composition: beat.composition,
        graphicSpec: beat.graphicSpec, displayText: beat.displayText,
        visualStartSeconds: start,
        typographyStartSeconds: beat.displayText ? start + typographyDelay : null,
        endSeconds: end,
      });
    }
  }
  return { templateVersion: YOUTUBE_VISUAL_TEMPLATE_VERSION, audioSha256: transcript.audioSha256,
    audioDurationSeconds: transcript.audioDurationSeconds, beats };
}
