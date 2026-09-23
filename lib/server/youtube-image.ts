import { ApiError } from "@/lib/http";

const ENDPOINT = "https://api.openai.com/v1/images/generations";
const MODEL = "gpt-image-2.5-sunburst";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export async function generateYoutubeStill(prompt: string, options: { apiKey: string; signal?: AbortSignal; fetcher?: typeof fetch }) {
  if (!prompt.trim() || prompt.length > 2_000) throw new ApiError(400, "IMAGE_PROMPT_INVALID", "화면 이미지 설명을 확인해 주세요.");
  if (!options.apiKey.trim()) throw new ApiError(503, "OPENAI_NOT_CONFIGURED", "OpenAI 이미지 생성 키가 연결되지 않았습니다.");
  const response = await (options.fetcher ?? fetch)(ENDPOINT, {
    method: "POST", cache: "no-store", signal: options.signal ?? AbortSignal.timeout(150_000),
    headers: { authorization: `Bearer ${options.apiKey.trim()}`, "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, size: "1536x864", quality: "high", output_format: "png", n: 1,
      prompt: `${prompt.trim()}\n\nPhotoreal editorial B-roll, landscape 16:9 composition for a thoughtful Korean educational YouTube video. Restrained art direction, consistent materials and lighting. Leave a clear area for later Korean graphics. No letters, captions, logos, or watermarks. This is a generic illustration, not documentary evidence of a real event or real person.` }),
  });
  const body = await response.json().catch(() => ({})) as { data?: Array<{ b64_json?: string }> };
  if (!response.ok) throw new ApiError(502, "IMAGE_GENERATION_FAILED", "화면 이미지 생성에 실패했습니다.");
  const encoded = body.data?.[0]?.b64_json;
  if (!encoded || encoded.length > MAX_IMAGE_BYTES * 1.5) throw new ApiError(502, "IMAGE_RESPONSE_INVALID", "화면 이미지 결과를 확인할 수 없습니다.");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 24 || bytes.length > MAX_IMAGE_BYTES || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    throw new ApiError(502, "IMAGE_RESPONSE_INVALID", "화면 이미지 형식을 확인할 수 없습니다.");
  return { bytes, model: MODEL, mimeType: "image/png" as const };
}
