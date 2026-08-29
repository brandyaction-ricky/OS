import { ApiError } from "@/lib/http";
import { OPENAI_EMBEDDING_MODEL } from "@/lib/config";

export async function createEmbeddings(input: string[], timeoutMs = 8_000): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new ApiError(503, "EMBEDDINGS_NOT_CONFIGURED", "의미 검색 설정이 필요합니다.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: OPENAI_EMBEDDING_MODEL, input, dimensions: 1536 }),
      signal: controller.signal,
    });
    const body = await response.json();
    if (!response.ok) throw new ApiError(502, "EMBEDDING_PROVIDER_ERROR", "의미 검색 준비에 실패했습니다.");
    if (body.model && body.model !== OPENAI_EMBEDDING_MODEL) throw new ApiError(502, "EMBEDDING_MODEL_MISMATCH", "임베딩 모델이 서버 설정과 다릅니다.");
    const vectors = body.data?.sort((a: { index: number }, b: { index: number }) => a.index - b.index).map((item: { embedding: number[] }) => item.embedding);
    if (!Array.isArray(vectors) || vectors.length !== input.length || vectors.some((vector) => vector.length !== 1536)) {
      throw new ApiError(502, "INVALID_EMBEDDING_RESPONSE", "임베딩 응답의 크기가 올바르지 않습니다.");
    }
    return vectors;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new ApiError(504, "EMBEDDING_TIMEOUT", "의미 검색 준비 시간이 초과되었습니다.");
    throw new ApiError(502, "EMBEDDING_PROVIDER_ERROR", "의미 검색 준비에 실패했습니다.");
  } finally { clearTimeout(timer); }
}

export function toPgVector(vector: number[]) {
  return `[${vector.join(",")}]`;
}
