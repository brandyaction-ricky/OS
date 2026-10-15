import { ApiError } from "@/lib/http";
import { z } from "zod";

export const FISH_TTS_ENDPOINT = "https://api.fish.audio/v1/tts";
export const FISH_TTS_TIMESTAMPS_ENDPOINT = "https://api.fish.audio/v1/tts/stream/with-timestamp";
export const FISH_SEGMENT_MAX_CHARS = 1_800;
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const MAX_SSE_BYTES = 24 * 1024 * 1024;

const fishTime = z.number().finite().nonnegative().max(14_400);
const fishTimestampEventSchema = z.object({
  audio_base64: z.string(),
  content: z.string(),
  chunk_seq: z.number().int().nonnegative(),
  chunk_audio_offset_sec: fishTime,
  alignment: z.object({
    audio_duration: fishTime,
    segments: z.array(z.object({ text: z.string(), start: fishTime, end: fishTime }).passthrough()).max(3_000),
  }).passthrough().nullable(),
}).passthrough();

export type FishTimedWord = { text: string; startSeconds: number; endSeconds: number };

function requireMp3(bytes: Buffer) {
  if (bytes.length < 4 || bytes.length > MAX_AUDIO_BYTES ||
    !(bytes.subarray(0, 3).toString("ascii") === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)))
    throw new ApiError(502, "FISH_AUDIO_INVALID", "생성된 음성 파일 형식을 확인할 수 없습니다.");
}

/** Fish sends every audio packet, but later alignment snapshots replace earlier ones for the same text chunk. */
export async function parseFishTimestampedStream(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  const audioChunks: Buffer[] = [];
  const alignmentByChunk = new Map<number, { offset: number; duration: number; words: FishTimedWord[] }>();
  let audioBytes = 0;
  let wireBytes = 0;
  let pending = "";
  let seenEvents = 0;

  function consumeEvent(frame: string) {
    const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") return;
    let payload: unknown;
    try { payload = JSON.parse(data); } catch { throw new ApiError(502, "FISH_TIMESTAMPS_INVALID", "Fish Audio 시간 정보 형식이 올바르지 않습니다."); }
    const parsed = fishTimestampEventSchema.safeParse(payload);
    if (!parsed.success) throw new ApiError(502, "FISH_TIMESTAMPS_INVALID", "Fish Audio 시간 정보를 읽을 수 없습니다.");
    const event = parsed.data;
    seenEvents++;
    if (seenEvents > 20_000 || event.audio_base64.length > MAX_SSE_BYTES ||
      (event.audio_base64 && (!/^[A-Za-z0-9+/]*={0,2}$/.test(event.audio_base64) || event.audio_base64.length % 4 !== 0)))
      throw new ApiError(502, "FISH_TIMESTAMPS_INVALID", "Fish Audio 음성 패킷 형식이 올바르지 않습니다.");
    const chunk = Buffer.from(event.audio_base64, "base64");
    audioBytes += chunk.length;
    if (audioBytes > MAX_AUDIO_BYTES) throw new ApiError(502, "FISH_AUDIO_TOO_LARGE", "음성 응답 크기가 허용 범위를 넘었습니다.");
    if (chunk.length) audioChunks.push(chunk);
    if (event.alignment !== null) {
      // Fish emits zero-length punctuation tokens and ends that overshoot the chunk slightly; clamp them into the chunk.
      const offset = event.chunk_audio_offset_sec, limit = offset + event.alignment.audio_duration;
      const words = event.alignment.segments.filter((segment) => segment.text.trim()).map((segment) => {
        const startSeconds = Math.min(Math.max(offset + segment.start, offset), limit);
        return { text: segment.text, startSeconds, endSeconds: Math.min(Math.max(offset + segment.end, startSeconds + 0.01), limit + 0.01) };
      });
      alignmentByChunk.set(event.chunk_seq, {
        offset: event.chunk_audio_offset_sec, duration: event.alignment.audio_duration, words,
      });
    }
  }

  function consumeFrames() {
    let boundary = pending.indexOf("\n\n");
    while (boundary >= 0) {
      consumeEvent(pending.slice(0, boundary));
      pending = pending.slice(boundary + 2);
      boundary = pending.indexOf("\n\n");
    }
  }

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      wireBytes += value.byteLength;
      if (wireBytes > MAX_SSE_BYTES) throw new ApiError(502, "FISH_AUDIO_TOO_LARGE", "Fish Audio 응답 크기가 허용 범위를 넘었습니다.");
      pending = (pending + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
      consumeFrames();
    }
    pending = (pending + decoder.decode()).replace(/\r\n/g, "\n");
    consumeFrames();
    if (pending.trim()) consumeEvent(pending);
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(audioChunks);
  requireMp3(bytes);
  if (!alignmentByChunk.size) throw new ApiError(502, "FISH_TIMESTAMPS_MISSING", "Fish Audio가 단어 시간표를 반환하지 않았습니다.");
  const words: FishTimedWord[] = [];
  let durationSeconds = 0;
  for (const [, snapshot] of [...alignmentByChunk.entries()].sort(([a], [b]) => a - b)) {
    words.push(...snapshot.words);
    durationSeconds = Math.max(durationSeconds, snapshot.offset + snapshot.duration);
  }
  if (!words.length) throw new ApiError(502, "FISH_TIMESTAMPS_INVALID", "Fish Audio 단어 시간 순서를 확인할 수 없습니다.");
  // Small overlaps between neighbouring words are alignment noise: start each word no earlier than the previous one ends.
  for (let index = 1; index < words.length; index++) {
    const previous = words[index - 1], word = words[index];
    if (word.startSeconds < previous.endSeconds) words[index] = { ...word, startSeconds: previous.endSeconds, endSeconds: Math.max(word.endSeconds, previous.endSeconds + 0.01) };
  }
  return { bytes, mimeType: "audio/mpeg" as const, words, durationSeconds };
}

/** Keep narration chunks short enough to retry a single paragraph without regenerating a whole video. */
export function splitFishNarration(script: string): string[] {
  const normalized = script.replace(/\r\n?/g, "\n").trim();
  if (!normalized || normalized.length > 60_000) throw new ApiError(400, "VOICE_SCRIPT_INVALID", "음성 원고의 길이를 확인해 주세요.");
  const paragraphs = normalized.split(/\n\s*\n/).map((part) => part.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
  const chunks: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= FISH_SEGMENT_MAX_CHARS) { chunks.push(paragraph); continue; }
    const sentences = paragraph.match(/[^.!?。！？]+[.!?。！？]?/g) ?? [paragraph];
    let current = "";
    for (const raw of sentences) {
      const sentence = raw.trim();
      if (!sentence) continue;
      if (sentence.length > FISH_SEGMENT_MAX_CHARS) throw new ApiError(400, "VOICE_SENTENCE_TOO_LONG", "긴 문장을 나누어 원고를 저장해 주세요.");
      if (current && `${current} ${sentence}`.length > FISH_SEGMENT_MAX_CHARS) { chunks.push(current); current = ""; }
      current = current ? `${current} ${sentence}` : sentence;
    }
    if (current) chunks.push(current);
  }
  if (!chunks.length || chunks.length > 80) throw new ApiError(400, "VOICE_SEGMENTS_INVALID", "음성 원고를 80개 이하의 단락으로 나누어 주세요.");
  return chunks;
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export interface FishVoiceSettings { speed?: number; temperature?: number; topP?: number }

/** Optional delivery tuning from server env; unset values keep Fish defaults. */
export function fishVoiceSettings(env: Record<string, string | undefined>): FishVoiceSettings {
  const read = (name: string, min: number, max: number) => {
    const raw = env[name]?.trim();
    if (!raw) return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max)
      throw new ApiError(503, "FISH_SETTINGS_INVALID", `${name} 값을 확인해 주세요.`);
    return value;
  };
  const settings = { speed: read("FISH_TTS_SPEED", 0.5, 2), temperature: read("FISH_TTS_TEMPERATURE", 0, 1), topP: read("FISH_TTS_TOP_P", 0, 1) };
  return Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined));
}

function fishBody(text: string, referenceId: string, settings: FishVoiceSettings = {}) {
  return {
    text: text.trim(), reference_id: referenceId.trim(), format: "mp3",
    ...(settings.speed !== undefined ? { prosody: { speed: settings.speed } } : {}),
    ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
    ...(settings.topP !== undefined ? { top_p: settings.topP } : {}),
  };
}

export async function synthesizeFishSegment(text: string, options: {
  apiKey: string; referenceId: string; model?: string; settings?: FishVoiceSettings; fetcher?: Fetcher; signal?: AbortSignal;
}) {
  if (!text.trim() || text.length > FISH_SEGMENT_MAX_CHARS) throw new ApiError(400, "VOICE_SEGMENT_INVALID", "음성 단락의 길이를 확인해 주세요.");
  if (!options.apiKey.trim() || !options.referenceId.trim()) throw new ApiError(503, "FISH_NOT_CONFIGURED", "Fish Audio API 키와 비공개 목소리 ID가 필요합니다.");
  const response = await (options.fetcher ?? fetch)(FISH_TTS_ENDPOINT, {
    method: "POST", cache: "no-store", signal: options.signal ?? AbortSignal.timeout(60_000),
    headers: { authorization: `Bearer ${options.apiKey.trim()}`, "content-type": "application/json", model: options.model?.trim() || "s2.1-pro" },
    body: JSON.stringify(fishBody(text, options.referenceId, options.settings)),
  });
  if (!response.ok) throw new ApiError(502, "FISH_TTS_FAILED", `Fish Audio 음성 생성에 실패했습니다 (${response.status}).`);
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !/(audio\/mpeg|audio\/mp3|application\/octet-stream)/i.test(contentType))
    throw new ApiError(502, "FISH_AUDIO_INVALID", "Fish Audio가 음성 파일을 반환하지 않았습니다.");
  if (Number(response.headers.get("content-length") ?? 0) > MAX_AUDIO_BYTES) throw new ApiError(502, "FISH_AUDIO_TOO_LARGE", "음성 응답 크기가 허용 범위를 넘었습니다.");
  const bytes = Buffer.from(await response.arrayBuffer());
  requireMp3(bytes);
  return { bytes, mimeType: "audio/mpeg" as const };
}

/** Generate one narration segment and its word timing in the same Fish request. */
export async function synthesizeFishSegmentWithTimestamps(text: string, options: {
  apiKey: string; referenceId: string; model?: string; settings?: FishVoiceSettings; fetcher?: Fetcher; signal?: AbortSignal;
}) {
  if (!text.trim() || text.length > FISH_SEGMENT_MAX_CHARS)
    throw new ApiError(400, "VOICE_SEGMENT_INVALID", "음성 단락의 길이를 확인해 주세요.");
  if (!options.apiKey.trim() || !options.referenceId.trim())
    throw new ApiError(503, "FISH_NOT_CONFIGURED", "Fish Audio API 키와 비공개 목소리 ID가 필요합니다.");
  const response = await (options.fetcher ?? fetch)(FISH_TTS_TIMESTAMPS_ENDPOINT, {
    method: "POST", cache: "no-store", signal: options.signal ?? AbortSignal.timeout(90_000),
    headers: { authorization: `Bearer ${options.apiKey.trim()}`, "content-type": "application/json", model: options.model?.trim() || "s2.1-pro" },
    body: JSON.stringify({ ...fishBody(text, options.referenceId, options.settings), latency: "balanced" }),
  });
  if (!response.ok) throw new ApiError(502, "FISH_TTS_FAILED", `Fish Audio 음성 생성에 실패했습니다 (${response.status}).`);
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !/text\/event-stream/i.test(contentType))
    throw new ApiError(502, "FISH_TIMESTAMPS_INVALID", "Fish Audio가 시간 정보 스트림을 반환하지 않았습니다.");
  if (Number(response.headers.get("content-length") ?? 0) > MAX_SSE_BYTES)
    throw new ApiError(502, "FISH_AUDIO_TOO_LARGE", "Fish Audio 응답 크기가 허용 범위를 넘었습니다.");
  if (!response.body) throw new ApiError(502, "FISH_TIMESTAMPS_MISSING", "Fish Audio 음성 응답이 비어 있습니다.");
  return parseFishTimestampedStream(response.body);
}
