import { ApiError } from "@/lib/http";

export const FISH_TTS_ENDPOINT = "https://api.fish.audio/v1/tts";
export const FISH_SEGMENT_MAX_CHARS = 1_800;
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

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

export async function synthesizeFishSegment(text: string, options: {
  apiKey: string; referenceId: string; model?: string; fetcher?: Fetcher; signal?: AbortSignal;
}) {
  if (!text.trim() || text.length > FISH_SEGMENT_MAX_CHARS) throw new ApiError(400, "VOICE_SEGMENT_INVALID", "음성 단락의 길이를 확인해 주세요.");
  if (!options.apiKey.trim() || !options.referenceId.trim()) throw new ApiError(503, "FISH_NOT_CONFIGURED", "Fish Audio API 키와 비공개 목소리 ID가 필요합니다.");
  const response = await (options.fetcher ?? fetch)(FISH_TTS_ENDPOINT, {
    method: "POST", cache: "no-store", signal: options.signal ?? AbortSignal.timeout(60_000),
    headers: { authorization: `Bearer ${options.apiKey.trim()}`, "content-type": "application/json", model: options.model?.trim() || "s2.1-pro" },
    body: JSON.stringify({ text: text.trim(), reference_id: options.referenceId.trim(), format: "mp3" }),
  });
  if (!response.ok) throw new ApiError(502, "FISH_TTS_FAILED", `Fish Audio 음성 생성에 실패했습니다 (${response.status}).`);
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !/(audio\/mpeg|audio\/mp3|application\/octet-stream)/i.test(contentType))
    throw new ApiError(502, "FISH_AUDIO_INVALID", "Fish Audio가 음성 파일을 반환하지 않았습니다.");
  if (Number(response.headers.get("content-length") ?? 0) > MAX_AUDIO_BYTES) throw new ApiError(502, "FISH_AUDIO_TOO_LARGE", "음성 응답 크기가 허용 범위를 넘었습니다.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 4 || bytes.length > MAX_AUDIO_BYTES || !(bytes.subarray(0, 3).toString("ascii") === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)))
    throw new ApiError(502, "FISH_AUDIO_INVALID", "생성된 음성 파일 형식을 확인할 수 없습니다.");
  return { bytes, mimeType: "audio/mpeg" as const };
}
