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
  svg: string;
  displayText: string;
  accentText: string;
  typographyAnchor: string;
  visualStartSeconds: number;
  typographyStartSeconds: number | null;
  endSeconds: number;
  /** Seconds after visualStartSeconds when each reveal group of the drawing starts, from its spoken cue. */
  cueSeconds?: number[];
};

export type YoutubeCaption = { startSeconds: number; endSeconds: number; text: string; hidden: boolean };

export type YoutubeRenderTimeline = {
  templateVersion: typeof YOUTUBE_VISUAL_TEMPLATE_VERSION;
  audioSha256: string;
  audioDurationSeconds: number;
  beats: YoutubeTimedVisualBeat[];
  captions: YoutubeCaption[];
};

/** Split one narration paragraph into short caption lines at spaces, breaking after sentence or clause ends. */
export function captionChunks(text: string, max = 22) {
  const chunks: string[] = [];
  // A tail of a few characters ("있습니다") joins the line before it instead of flashing alone.
  const push = (line: string) => { if (line.length < 6 && chunks.length) chunks[chunks.length - 1] += ` ${line}`; else chunks.push(line); };
  let current = "";
  for (const word of text.replace(/\s+/g, " ").trim().split(" ")) {
    if (current && `${current} ${word}`.length > max) { push(current); current = ""; }
    current = current ? `${current} ${word}` : word;
    if (/[.!?。,]$/.test(word) && current.length >= 8) { push(current); current = ""; }
  }
  if (current) push(current);
  return chunks;
}

const screenText = (beat: YoutubeTimedVisualBeat) => normalizedSpeech(`${beat.svg.replace(/<[^>]*>/g, " ")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")} ${beat.displayText}`);

const covered = (part: string, whole: string) => {
  const pairs = [...part].slice(1).map((ch, i) => part[i] + ch);
  return pairs.length >= 3 && pairs.filter((pair) => whole.includes(pair)).length / pairs.length >= 0.6;
};

/** A caption is left out while the same words are already written on screen, either way round. */
export function captionShownOnScreen(caption: string, screen: string) {
  const text = normalizedSpeech(caption);
  if (!text || !screen) return false;
  if (screen.includes(text) || covered(text, screen)) return true;
  return screen.length >= 5 && (text.includes(screen) || covered(screen, text));
}

/** The private media worker serializes this brief for the offline frame renderer. */
export function createYoutubeRenderBrief(plan: YoutubeScenePlan, timeline: YoutubeRenderTimeline) {
  // Open notes were acknowledged by the owner before voice; here only the plan-to-timeline binding is checked.
  if (timeline.templateVersion !== YOUTUBE_VISUAL_TEMPLATE_VERSION || !timeline.beats.length ||
    !plan.visualFirst || plan.typographyMode !== "single_active_cue")
    throw new ApiError(409, "YOUTUBE_RENDER_BRIEF_INVALID", "화면 설계와 시간표의 버전을 확인해 주세요.");
  const expected = plan.scenes.reduce((count, scene) => count + scene.visualBeats.length, 0);
  if (timeline.beats.length > expected)
    throw new ApiError(409, "YOUTUBE_RENDER_BRIEF_INVALID", "화면 비트와 음성 시간표 수가 다릅니다.");
  for (const beat of timeline.beats) {
    const planned = plan.scenes[beat.segmentIndex]?.visualBeats[beat.beatIndex];
    // Alignment may fold a beat away or leave its headline out, but never invents or edits one.
    const titleKept = planned && planned.displayText === beat.displayText && planned.accentText === beat.accentText &&
      planned.typographyAnchor === beat.typographyAnchor;
    const titleDropped = !beat.displayText && !beat.accentText && !beat.typographyAnchor && beat.typographyStartSeconds === null;
    if (!planned || planned.spokenAnchor !== beat.spokenAnchor || planned.svg !== beat.svg || !(titleKept || titleDropped))
      throw new ApiError(409, "YOUTUBE_RENDER_BRIEF_INVALID", "화면 계획이 시간표 생성 후 변경됐습니다.");
  }
  return { timingSource: "verified_word" as const, timeline, scenePlan: plan };
}

/**
 * Convert speech anchors into exact video positions without asking the scene model to guess
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
  const captions: YoutubeCaption[] = [];
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

    // Resolve each beat's spoken start; a beat whose anchor cannot be placed after the previous one is folded into it.
    const placed: Array<{ beatIndex: number; start: number; typographyStart: number | null; at: number }> = [];
    let searchFrom = 0;
    for (const [beatIndex, beat] of scene.visualBeats.entries()) {
      const anchor = normalizedSpeech(beat.spokenAnchor);
      const characterIndex = anchor ? sourceText.indexOf(anchor, searchFrom) : -1;
      if (characterIndex < 0) continue;
      const start = segment.offsetSeconds + segment.words[characterWordIndexes[characterIndex]].startSeconds;
      if (placed.length && start <= placed[placed.length - 1].start + 0.04) continue;
      const typographyIndex = beat.typographyAnchor ? sourceText.indexOf(normalizedSpeech(beat.typographyAnchor), characterIndex + 1) : -1;
      const typographyStart = typographyIndex < 0 ? null : segment.offsetSeconds + segment.words[characterWordIndexes[typographyIndex]].startSeconds;
      placed.push({ beatIndex, start, typographyStart, at: characterIndex });
      searchFrom = characterIndex + anchor.length;
    }
    if (!placed.length) throw new ApiError(409, "YOUTUBE_ANCHOR_MISMATCH", "화면 비트의 멘트를 승인된 원고 순서에서 찾지 못했습니다.");

    // A beat too short to read is dropped and the previous beat stays on screen; the first beat of a segment covers from its start.
    const segmentEnd = segment.offsetSeconds + segment.durationSeconds;
    const kept: typeof placed = [];
    for (const [index, item] of placed.entries()) {
      const span = (placed[index + 1]?.start ?? segmentEnd) - item.start;
      const minimum = scene.visualBeats[item.beatIndex].svg.includes("data-character=") ? 1.25 : 0.45;
      if (span >= minimum || (!kept.length && index === placed.length - 1)) kept.push(item);
      else if (!kept.length && placed[index + 1]) placed[index + 1] = { ...placed[index + 1], start: item.start };
    }
    for (const [index, item] of kept.entries()) {
      const beat = scene.visualBeats[item.beatIndex];
      const start = index ? item.start : Math.min(item.start, placed[0].start);
      const end = kept[index + 1]?.start ?? segmentEnd;
      // The drawing leads the headline; a headline that cannot follow the drawing inside this beat is left out.
      const typographyStart = item.typographyStart === null ? null : Math.max(item.typographyStart, start + 0.16);
      const showTitle = typographyStart !== null && typographyStart < end - 0.12;
      // Each reveal group of the drawing starts when its cue is spoken inside this beat; a missing cue follows the previous one.
      const rangeEnd = kept[index + 1]?.at ?? sourceText.length;
      let cueFrom = item.at, lastCue = 0;
      const cueSeconds = beat.cues?.map((cue) => {
        const at = normalizedSpeech(cue) ? sourceText.indexOf(normalizedSpeech(cue), cueFrom) : -1;
        const spoken = at >= 0 && at < rangeEnd ? segment.offsetSeconds + segment.words[characterWordIndexes[at]].startSeconds - start : lastCue + 0.45;
        if (at >= 0 && at < rangeEnd) cueFrom = at;
        lastCue = Math.min(Math.max(spoken, lastCue), Math.max(0, end - start - 0.4));
        return Math.round(lastCue * 100) / 100;
      });
      beats.push({
        segmentIndex, beatIndex: item.beatIndex, spokenAnchor: beat.spokenAnchor, svg: beat.svg,
        displayText: showTitle ? beat.displayText : "", accentText: showTitle ? beat.accentText : "", typographyAnchor: showTitle ? beat.typographyAnchor : "",
        visualStartSeconds: start,
        typographyStartSeconds: showTitle ? typographyStart : null,
        endSeconds: end,
        ...(cueSeconds?.length ? { cueSeconds } : {}),
      });
    }

    // Captions follow the verified words; each line holds until the next one starts.
    let offset = 0;
    const lines = captionChunks(scriptSegments[segmentIndex]).flatMap((chunk) => {
      const size = normalizedSpeech(chunk).length;
      if (!size) return [];
      const first = segment.words[characterWordIndexes[offset]], last = segment.words[characterWordIndexes[offset + size - 1]];
      offset += size;
      return [{ text: chunk.replace(/[.,]$/, ""), startSeconds: segment.offsetSeconds + first.startSeconds, endSeconds: segment.offsetSeconds + last.endSeconds }];
    });
    lines.forEach((line, i) => {
      const next = lines[i + 1]?.startSeconds ?? segmentEnd;
      captions.push({ ...line, endSeconds: Math.max(line.endSeconds, Math.min(next, line.endSeconds + 0.6)), hidden: false });
    });
  }
  for (const caption of captions) {
    const middle = (caption.startSeconds + caption.endSeconds) / 2;
    const beat = beats.find((item) => item.visualStartSeconds <= middle && middle < item.endSeconds);
    caption.hidden = Boolean(beat && captionShownOnScreen(caption.text, screenText(beat)));
  }
  return { templateVersion: YOUTUBE_VISUAL_TEMPLATE_VERSION, audioSha256: transcript.audioSha256,
    audioDurationSeconds: transcript.audioDurationSeconds, beats, captions };
}
